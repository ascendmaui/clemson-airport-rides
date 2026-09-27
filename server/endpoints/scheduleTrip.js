/**
 * POST /api/stripe-payment-methods?action=schedule-trip
 * Records a campus or airport trip at the server fare. Client fare_cents,
 * amount, total, and isStudent are ignored.
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import { loadGameDayMultiplier } from '../creditLots.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { airportCodeForPlace, firstName } from '../../src/lib/scheduledRideModel.js'
import { splitPlatformFee } from '../../src/lib/fareRates.js'
import {
  AIRPORT_DROPOFFS,
  CAMPUS_PICKUP,
  parseRideAt,
  priceScheduledRequest,
} from '../authoritativeFare.js'
import { insertTripEvent } from '../tripEvents.js'


/** Integer passenger count from the request; default 1. Prefer passengers over partySize. */
function passengerCount(body) {
  const raw = body?.passengers ?? body?.partySize ?? body?.party_size
  if (raw == null || raw === '') return 1
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

const PURPOSES = new Set(['early_class', 'airport', 'planned', 'party_weekend', 'recurring'])

function place(value) {
  if (!value || typeof value !== 'object') return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const label = String(value.label || '').trim().slice(0, 160)
  if (!label) return null
  return { label, lat, lng }
}

async function distanceBetween(origin, dest) {
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

  const purpose = PURPOSES.has(body.purpose) ? body.purpose : 'planned'
  const tier = body.tier === 'tesla' ? 'tesla' : 'standard'
  const airport = body.airport ? String(body.airport).toUpperCase() : null
  const when = parseRideAt(body, new Date())
  const scheduled = Boolean(body.date || body.pickupAt)
  if (scheduled && when.getTime() < Date.now() + 30 * 60 * 1000) {
    return json(res, 400, { error: 'Schedule at least 30 minutes ahead.' })
  }

  let pickup = place(body.pickup)
  let dropoff = place(body.dropoff)
  const airportCode = airport === 'GSP' || airport === 'CLT'
    ? airport
    : airportCodeForPlace(dropoff)
  if (airportCode === 'GSP' || airportCode === 'CLT') {
    pickup = CAMPUS_PICKUP
    dropoff = AIRPORT_DROPOFFS[airportCode]
  }
  if (!pickup || !dropoff) return json(res, 400, { error: 'Choose a pickup and a drop-off.' })
  if (pickup.label === dropoff.label) return json(res, 400, { error: 'Pickup and drop-off need to be different places.' })

  const distance = await distanceBetween(pickup, dropoff)
  let gameDayMultiplier = null
  try {
    const game = await loadGameDayMultiplier(sb, when)
    gameDayMultiplier = game.multiplier
  } catch {
    gameDayMultiplier = null
  }

  const isStudent = studentDiscountGranted(user)
  const priced = priceScheduledRequest({
    pickup,
    dropoff,
    airport: airportCode === 'GSP' || airportCode === 'CLT' ? airportCode : null,
    at: when,
    isStudent,
    tier,
    gameDayMultiplier,
    distanceM: distance.distanceM,
    durationS: distance.durationS,
  })

  const split = splitPlatformFee(priced.fareCents)
  const scheduledFor = scheduled ? when.toISOString() : null
  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.filter((day) => typeof day === 'string').slice(0, 7)
    : []
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  const metadata = {
    kind: scheduledFor ? 'scheduled' : 'airport',
    purpose: priced.airport ? 'airport' : purpose,
    rider_first_name: riderFirst,
    fare_is_estimate: Boolean(priced.estimate),
    reminders: {},
    isStudent: Boolean(priced.isStudent && priced.discountCents > 0),
    student_discount_cents: Math.max(0, priced.discountCents || 0),
    studentLabel: priced.discountCents > 0 ? 'Clemson student · 10% off Standard' : null,
    recurrence: purpose === 'recurring' ? { interval: 'weekly', weekdays } : null,
    party: purpose === 'party_weekend' ? 'weekend' : null,
    tesla: tier === 'tesla',
    fleet: tier === 'tesla' ? 'tesla_model_3' : 'standard',
    fare_source: 'server',
    airport: priced.airport,
  }
  const row = {
    rider_id: user.id,
    status: scheduledFor ? 'scheduled' : 'searching',
    tier,
    pickup_label: pickup.label,
    dropoff_label: dropoff.label,
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    dropoff_lat: dropoff.lat,
    dropoff_lng: dropoff.lng,
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
    passengers: passengerCount(body),
    pickup_at: scheduledFor,
    scheduled_for: scheduledFor,
    rider_note: purpose,
    metadata,
  }

  const profileRes = await runEnsureProfile(sb, user)
  if (!profileRes?.ok) {
    return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
  }

  const inserted = await sb.from('trips').insert(row).select('id, status, pickup_at, pickup_label, dropoff_label, fare_cents, deposit_cents').single()
  if (inserted.error || !inserted.data) {
    return json(res, 500, { error: inserted.error?.message || 'Could not schedule ride' })
  }
  const { error: eventError } = await insertTripEvent(sb, {
    trip_id: inserted.data.id,
    kind: 'scheduled',
    payload: {
      pickup_at: scheduledFor,
      purpose,
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
    estimate: priced.estimate,
  })
}
