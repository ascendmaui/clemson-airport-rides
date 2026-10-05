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
import { billingForPricedRide } from '../rideBilling.js'
import { resolveOfferedTier, scheduleDiscountMetadata } from '../../shared/rideOptions.js'
import { assertTierAvailable } from '../rideAvailability.js'
import {
  PARTY_FARE_COPY,
  WEEKEND_WINDOW_COPY,
  partyCapacityMessage,
  passengerCount,
  passengerCountLabel,
  weekendWindowNote,
} from '../../src/lib/schedulePartyCopy.js'

export {
  PARTY_FARE_COPY,
  SCHEDULE_PARTY_SEAT_CAP,
  WEEKEND_WINDOW_COPY,
  isScheduleWeekendWindow,
  partyCapacityMessage,
  partyFareCopy,
  passengerCount,
  passengerCountLabel,
  weekendWindowCopy,
  weekendWindowNote,
} from '../../src/lib/schedulePartyCopy.js'

const PURPOSES = new Set(['game_day', 'early_class', 'airport', 'planned', 'party_weekend', 'recurring'])

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
  let tier
  try {
    tier = resolveOfferedTier(body.tier)
  } catch (error) {
    return json(res, error.status || 400, { error: error.message, code: error.code || 'ride_option_unavailable' })
  }
  const airport = body.airport ? String(body.airport).toUpperCase() : null
  const clockNow =
    typeof deps.now === 'function' ? deps.now() : deps.now != null ? Number(deps.now) : Date.now()
  const when = parseRideAt(body, new Date(clockNow))
  const scheduled = Boolean(body.date || body.pickupAt)
  if (!Number.isFinite(when.getTime())) return json(res, 400, { error: 'Choose a valid pickup time.' })
  if (scheduled && when.getTime() < clockNow + 30 * 60 * 1000) {
    return json(res, 400, { error: 'Schedule at least 30 minutes ahead.' })
  }
  try {
    await assertTierAvailable(sb, tier, {
      scheduledFor: scheduled ? when : null,
      now: new Date(clockNow),
    })
  } catch (error) {
    return json(res, error.status || 409, { error: error.message, code: error.code || 'ride_option_unavailable' })
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
    scheduleAhead: scheduled,
    now: new Date(clockNow),
  })

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
  const scheduledFor = scheduled ? when.toISOString() : null
  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.filter((day) => typeof day === 'string').slice(0, 7)
    : []
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  const passengers = passengerCount(body)
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
    ride_option: tier,
    fare_source: 'server',
    ...scheduleDiscountMetadata(priced),
    airport: priced.airport,
    ...billing.snapshot,
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
    passengers,
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
    fareBeforeScheduleDiscountCents: priced.fareBeforeScheduleDiscountCents ?? priced.fareCents,
    scheduleDiscountPct: priced.scheduleDiscountPct || 0,
    scheduleDiscountCents: priced.scheduleDiscountCents || 0,
    scheduleDiscountApplied: Boolean(priced.scheduleDiscountApplied),
    passengers,
    passengerLabel: passengerCountLabel(passengers),
    partyCapacityMessage: partyCapacityMessage(passengers),
    partyFareCopy: PARTY_FARE_COPY,
    weekendWindowCopy: purpose === 'party_weekend' ? WEEKEND_WINDOW_COPY : null,
    weekendWindowNote: scheduledFor ? weekendWindowNote(scheduledFor) : null,
  })
}
