/**
 * POST /api/stripe-payment-methods?action=request-driver
 * Records a campus trip at the server fare. Client fare, list price, amount,
 * and student flags are ignored. Campus rows have no deposit: status searching,
 * driver_id null, so any approved driver can accept and a decline stays in the
 * pool. GSP/CLT already collect a 25% deposit in Schedule checkout. This screen
 * does not open Checkout and does not insert an unpaid airport hold.
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import { loadGameDayMultiplier } from '../creditLots.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { firstName } from '../../src/lib/scheduledRideModel.js'
import { splitPlatformFee } from '../../src/lib/fareRates.js'
import {
  CAMPUS_PICKUP,
  priceDriverRequest,
  resolveDriverRequestPlaces,
} from '../authoritativeFare.js'
import { receivableDriverIds } from '../driverApproval.js'
import { listAssignableDrivers } from '../autoAssign.js'
import { comfortDecision, comfortEmptyMessage } from '../comfortMatch.js'
import { insertTripEvent } from '../tripEvents.js'
import { notifyDriverOffer } from '../driverOfferAlerts.js'
import { billingForPricedRide } from '../rideBilling.js'
import { resolveOfferedTier, vehicleServesComfort } from '../../shared/rideOptions.js'
import { isSimulatedDriverId } from '../../packages/rides-native/simulatedDrivers.js'
import { assertTierAvailable } from '../rideAvailability.js'
import { releaseTigerHeatReservation, reserveTigerHeatOffer } from '../tigerHeatService.js'

function optionError(res, error) {
  return json(res, error.status || 400, {
    error: error.message || 'That ride option is not offered.',
    code: error.code || 'ride_option_unavailable',
  })
}

async function serverDistance(origin, dest) {
  if (origin?.lat == null || dest?.lat == null) return { distanceM: null, durationS: null, polyline: null }
  const route = await computeRoutes(origin, dest, [])
  if (route.error) return { distanceM: null, durationS: null, polyline: null }
  return {
    distanceM: route.distanceM,
    durationS: route.durationS,
    polyline: route.polyline || null,
  }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const runEnsureProfile = deps.ensureProfile || ensureProfile

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const driverId = String(body.driverId || '').trim()
  if (isSimulatedDriverId(driverId)) {
    return json(res, 409, { error: 'That car is a map preview and cannot be requested.', code: 'ride_option_unavailable' })
  }
  const autoAssign = body.autoAssign === true && !driverId
  if (!driverId && !autoAssign) return json(res, 400, { error: 'Select a driver first' })

  let tier
  try {
    tier = resolveOfferedTier(body.tier)
  } catch (error) {
    return optionError(res, error)
  }

  if (!autoAssign) {
    const gate = await receivableDriverIds(sb, [driverId])
    if (gate.error) return json(res, 500, { error: gate.error, code: 'driver_approval_unavailable' })
    if (!gate.allowed.has(driverId)) {
      return json(res, 403, {
        error: 'That driver is not approved to receive rides yet.',
        code: 'driver_not_approved',
      })
    }
  }

  try {
    await assertTierAvailable(sb, tier)
  } catch (error) {
    return optionError(res, error)
  }
  const places = resolveDriverRequestPlaces({
    pickupLabel: body.pickupLabel,
    pickupLat: body.pickupLat ?? body.pickup_lat,
    pickupLng: body.pickupLng ?? body.pickup_lng,
    dropoffLabel: body.dest || body.dropoffLabel,
    dropoffLat: body.destLat ?? body.dest_lat ?? body.dropoffLat,
    dropoffLng: body.destLng ?? body.dest_lng ?? body.dropoffLng,
  })
  if (places.error) return json(res, 400, { error: places.error })

  let offerDriverId = driverId
  let assignQueue = null
  if (autoAssign) {
    const ordered = await listAssignableDrivers(sb, { tier, riderId: user.id })
    if (ordered.error) {
      return json(res, 500, { error: 'Could not choose a driver', code: 'auto_assign_unavailable' })
    }
    if (!ordered.drivers.length) {
      if (ordered.womenOnlyBlocked) {
        return json(res, 409, {
          error: comfortEmptyMessage(ordered),
          code: 'women_only_no_driver',
        })
      }
      return json(res, 409, {
        error: 'No approved drivers are online right now.',
        code: 'no_driver_online',
      })
    }
    assignQueue = ordered.drivers.map((driver) => driver.id)
    offerDriverId = assignQueue[0]
  }

  if (!autoAssign) {
    const comfort = await comfortDecision(sb, user.id, driverId)
    if (!comfort.ok) return json(res, comfort.status || 409, { error: comfort.error, code: comfort.code })
  }

  if (!autoAssign && tier === 'comfort') {
    const vehicleRes = await sb
      .from('vehicles')
      .select('service_class, tier')
      .eq('driver_id', driverId)
      .limit(1)
      .maybeSingle()
    if (vehicleRes.error) {
      return json(res, 500, { error: vehicleRes.error.message || 'Could not read the vehicle', code: 'vehicle_lookup_failed' })
    }
    if (!vehicleServesComfort(vehicleRes.data)) {
      return json(res, 409, {
        error: 'That driver is not available for Extra Comfort.',
        code: 'ride_option_unavailable',
      })
    }
  }

  const when = new Date()
  let gameDayMultiplier = null
  try {
    const game = await loadGameDayMultiplier(sb, when)
    gameDayMultiplier = game.multiplier
  } catch {
    gameDayMultiplier = null
  }

  const routeOrigin = places.airport ? CAMPUS_PICKUP : places.pickup
  const distance = await serverDistance(routeOrigin, places.dropoff)
  const isStudent = studentDiscountGranted(user)
  const priced = priceDriverRequest(places, {
    isStudent,
    at: when,
    tier,
    gameDayMultiplier,
    distanceM: distance.distanceM,
    durationS: distance.durationS,
  })
  if (priced?.fareCents == null || !Number.isFinite(Number(priced.fareCents))) {
    return json(res, 409, { error: 'Fare is not set', code: 'fare_not_set' })
  }

  if (Number(priced.depositCents) > 0) {
    return json(res, 409, {
      error: 'Airport rides collect a 25% deposit in checkout. Book this trip from Schedule so drivers can see it after that deposit is paid.',
      code: 'airport_deposit_required',
      depositCents: priced.depositCents,
    })
  }

  const billing = await billingForPricedRide(sb, user.id, body, priced)
  if (billing.error) {
    return json(res, billing.error.status || 409, {
      error: billing.error.error,
      code: billing.error.code,
      fareCents: priced.fareCents,
      depositCents: priced.depositCents,
      charged: false,
      debitedCents: 0,
    })
  }

  const split = splitPlatformFee(priced.fareCents)
  let tigerHeat = null
  try {
    tigerHeat = await reserveTigerHeatOffer({
      sb,
      pickupLat: places.pickup.lat,
      pickupLng: places.pickup.lng,
      riderFareCents: priced.fareCents,
    })
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'tiger_heat_offer_skipped',
      error: error?.message || String(error),
    }))
  }
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  const routeMeta = distance.polyline
    ? {
      route_polyline: distance.polyline,
      route_duration_s: distance.durationS,
      route_distance_m: distance.distanceM,
    }
    : {}
  const row = {
    rider_id: user.id,
    driver_id: null,
    // trip_status has searching, not "requested". That value aborts the insert.
    status: 'searching',
    tier,
    pickup_label: places.pickup.label,
    dropoff_label: places.dropoff.label,
    pickup_lat: places.pickup.lat,
    pickup_lng: places.pickup.lng,
    dropoff_lat: places.dropoff.lat,
    dropoff_lng: places.dropoff.lng,
    fare_cents: priced.fareCents,
    deposit_cents: priced.depositCents,
    platform_fee_cents: split.platformFeeCents,
    driver_earnings_cents: split.driverEarningsCents,
    surge_multiplier: priced.surge?.multiplier || 1,
    fare_breakdown: {
      ...(priced.breakdown || priced.quote?.breakdown || {}),
      route_source: priced.routeSource || null,
      fare_source: 'server',
      rider_pays_cents: priced.fareCents,
    },
    passengers: 1,
    metadata: {
      kind: 'driver_request',
      purpose: 'planned',
      preferred_driver_id: autoAssign ? null : driverId,
      offer_driver_id: offerDriverId || null,
      ...(assignQueue ? { auto_assign_queue: assignQueue } : {}),
      match: autoAssign ? 'auto' : 'open',
      ...routeMeta,
      rider_first_name: riderFirst,
      fare_is_estimate: Boolean(priced.estimate),
      isStudent: Boolean(priced.isStudent && priced.discountCents > 0),
      student_discount_cents: Math.max(0, priced.discountCents || 0),
      studentLabel: priced.discountCents > 0 ? 'Clemson student · 10% off Standard' : null,
      ride_option: tier,
      fare_source: 'server',
      airport: priced.airport,
      ...billing.snapshot,
      ...(tigerHeat ? { tiger_heat: tigerHeat } : {}),
    },
  }

  const profileRes = await runEnsureProfile(sb, user)
  if (!profileRes?.ok) {
    if (tigerHeat) await releaseTigerHeatReservation({ sb, trip: { metadata: { tiger_heat: tigerHeat } } })
    return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
  }

  const inserted = await sb.from('trips').insert(row).select('id, status, driver_id, dropoff_label, fare_cents, deposit_cents').single()
  if (inserted.error || !inserted.data) {
    if (tigerHeat) await releaseTigerHeatReservation({ sb, trip: { metadata: { tiger_heat: tigerHeat } } })
    return json(res, 500, { error: inserted.error?.message || 'Could not request trip' })
  }
  if (offerDriverId) {
    await notifyDriverOffer(sb, {
      trip: {
        id: inserted.data.id,
        pickup_label: row.pickup_label,
        dropoff_label: row.dropoff_label,
      },
      driverId: offerDriverId,
      offerMarker: 'initial',
    }, deps)
  }
  const { error: eventError } = await insertTripEvent(sb, {
    trip_id: inserted.data.id,
    kind: 'requested',
    payload: {
      driver_id: offerDriverId || null,
      match: autoAssign ? 'auto' : 'open',
      pickup_label: row.pickup_label,
      dropoff_label: row.dropoff_label,
      fare_cents: priced.fareCents,
      fare_source: 'server',
    },
  })
  if (eventError) {
    console.error('[request-driver] trip event', eventError.message || eventError)
    return json(res, 200, {
      trip: inserted.data,
      fareCents: priced.fareCents,
      depositCents: priced.depositCents,
      discountCents: priced.discountCents,
      studentDiscountApplied: priced.isStudent,
      eventWarning: eventError.message || 'Could not record trip event',
    })
  }

  return json(res, 200, {
    trip: inserted.data,
    fareCents: priced.fareCents,
    depositCents: priced.depositCents,
    discountCents: priced.discountCents,
    studentDiscountApplied: priced.isStudent,
  })
}
