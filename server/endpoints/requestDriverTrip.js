/**
 * POST /api/stripe-payment-methods?action=request-driver
 * Records a preferred-driver trip at the server fare. Client fare, list price,
 * amount, and student flags are ignored. GSP/CLT use the airport quote and a
 * 25% deposit. The rider email gate is studentDiscountGranted.
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
import { insertTripEvent } from '../tripEvents.js'

async function serverDistance(origin, dest) {
  if (origin?.lat == null || dest?.lat == null) return { distanceM: null, durationS: null }
  const route = await computeRoutes(origin, dest, [])
  if (route.error) return { distanceM: null, durationS: null }
  return { distanceM: route.distanceM, durationS: route.durationS }
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
  if (!driverId) return json(res, 400, { error: 'Select a driver first' })

  const tier = body.tier === 'tesla' ? 'tesla' : 'standard'
  const places = resolveDriverRequestPlaces({
    pickupLabel: body.pickupLabel,
    pickupLat: body.pickupLat ?? body.pickup_lat,
    pickupLng: body.pickupLng ?? body.pickup_lng,
    dropoffLabel: body.dest || body.dropoffLabel,
    dropoffLat: body.destLat ?? body.dest_lat ?? body.dropoffLat,
    dropoffLng: body.destLng ?? body.dest_lng ?? body.dropoffLng,
  })
  if (places.error) return json(res, 400, { error: places.error })

  const gate = await receivableDriverIds(sb, [driverId])
  if (gate.error) return json(res, 500, { error: gate.error, code: 'driver_approval_unavailable' })
  if (!gate.allowed.has(driverId)) {
    return json(res, 403, {
      error: 'That driver is not approved to receive rides yet.',
      code: 'driver_not_approved',
    })
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

  const split = splitPlatformFee(priced.fareCents)
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  const row = {
    rider_id: user.id,
    driver_id: driverId,
    status: 'requested',
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
      purpose: priced.airport ? 'airport' : 'planned',
      preferred_driver_id: driverId,
      match: 'preferred',
      rider_first_name: riderFirst,
      fare_is_estimate: Boolean(priced.estimate),
      isStudent: Boolean(priced.isStudent && priced.discountCents > 0),
      student_discount_cents: Math.max(0, priced.discountCents || 0),
      studentLabel: priced.discountCents > 0 ? 'Clemson student · 10% off Standard' : null,
      tesla: tier === 'tesla',
      fleet: tier === 'tesla' ? 'tesla_model_3' : 'standard',
      fare_source: 'server',
      airport: priced.airport,
    },
  }

  const profileRes = await runEnsureProfile(sb, user)
  if (!profileRes?.ok) {
    return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
  }

  const inserted = await sb.from('trips').insert(row).select('id, status, driver_id, dropoff_label, fare_cents, deposit_cents').single()
  if (inserted.error || !inserted.data) {
    return json(res, 500, { error: inserted.error?.message || 'Could not request trip' })
  }
  const { error: eventError } = await insertTripEvent(sb, {
    trip_id: inserted.data.id,
    kind: 'requested',
    payload: {
      driver_id: driverId,
      pickup_label: row.pickup_label,
      dropoff_label: row.dropoff_label,
      fare_cents: priced.fareCents,
      fare_source: 'server',
    },
  })
  if (eventError) {
    return json(res, 500, {
      error: eventError.message || 'Could not record trip event',
      code: 'trip_event_failed',
      trip: inserted.data,
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
