/**
 * POST /api/stripe-payment-methods?action=request-driver
 * Records a campus trip at the server fare. Client fare, list price, amount,
 * and student flags are ignored. Campus rows have no deposit. The first online
 * approved driver in house order is assigned (offered). If nobody is online the
 * row stays searching with driver_id null. GSP/CLT already collect a 25% deposit
 * in Schedule checkout. This screen does not open Checkout and does not insert
 * an unpaid airport hold.
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
import { pickAutoAssignDriver } from '../../shared/driverOrder.js'

function teslaListed(vehicle) {
  return Boolean(vehicle?.is_tesla)
    || vehicle?.tier === 'tesla'
    || vehicle?.tier === 'tesla_self_driving'
    || (String(vehicle?.make || '').toLowerCase() === 'tesla' && /model\s*3/i.test(String(vehicle?.model || '')))
}

/** First online approved driver in house order. Null keeps the open pool. */
async function onlineAutoAssignee(sb, { tier }) {
  let statusRes
  try {
    statusRes = await sb.from('driver_status').select('driver_id, online').eq('online', true)
  } catch {
    return null
  }
  if (!statusRes || statusRes.error) return null
  const onlineIds = []
  for (const row of statusRes.data || []) {
    if (row?.driver_id && row.online !== false && !onlineIds.includes(row.driver_id)) onlineIds.push(row.driver_id)
  }
  if (!onlineIds.length) return null

  let profilesRes
  try {
    profilesRes = await sb.from('profiles').select('id, email').in('id', onlineIds)
  } catch {
    return null
  }
  if (!profilesRes || profilesRes.error) return null

  const gate = await receivableDriverIds(sb, onlineIds)
  if (gate.error) return null

  let teslaIds = null
  if (tier === 'tesla') {
    let vehicleRes
    try {
      vehicleRes = await sb.from('vehicles').select('driver_id, is_tesla, tier, make, model').in('driver_id', onlineIds)
    } catch {
      return null
    }
    if (!vehicleRes || vehicleRes.error) return null
    teslaIds = new Set()
    for (const vehicle of vehicleRes.data || []) {
      if (teslaListed(vehicle)) teslaIds.add(vehicle.driver_id)
    }
  }

  const emailById = new Map((profilesRes.data || []).map((row) => [row.id, row.email]))
  const candidates = onlineIds
    .filter((id) => gate.allowed.has(id))
    .filter((id) => !teslaIds || teslaIds.has(id))
    .map((id) => ({ id, email: emailById.get(id) || '', online: true }))
  return pickAutoAssignDriver(candidates)
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

  if (tier === 'tesla') {
    const vehicleRes = await sb
      .from('vehicles')
      .select('is_tesla, tier, make, model')
      .eq('driver_id', driverId)
      .limit(1)
      .maybeSingle()
    if (vehicleRes.error) {
      return json(res, 500, { error: vehicleRes.error.message || 'Could not verify Tesla listing', code: 'tesla_vehicle_lookup_failed' })
    }
    const vehicle = vehicleRes.data
    const listed = teslaListed(vehicle)
    if (!listed) {
      return json(res, 409, {
        error: 'That driver is not listed for the Tesla Model 3 fleet. Pick a Tesla-listed driver.',
        code: 'tesla_driver_required',
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

  const assignee = await onlineAutoAssignee(sb, { tier })
  const assignedId = assignee?.id || null
  const split = splitPlatformFee(priced.fareCents)
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
    driver_id: assignedId,
    // trip_status has searching, not "requested". That value aborts the insert.
    status: assignedId ? 'offered' : 'searching',
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
      preferred_driver_id: driverId,
      match: assignedId ? 'auto' : 'open',
      assigned_driver_id: assignedId,
      ...routeMeta,
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
