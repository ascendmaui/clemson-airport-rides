/**
 * POST /api/quote-fare
 * Preview the fare that schedule, confirm, and driver request will save.
 * Google Routes when coordinates are sent and the server key is set.
 * Client fare, deposit, amount, total, miles, and isStudent are ignored.
 * Student eligibility is studentDiscountGranted on the signed-in user.
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../friendRideLib.js'
import { loadGameDayMultiplier } from '../creditLots.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { FARE_RATES_VERSION, splitPlatformFee } from '../../src/lib/fareRates.js'
import {
  parseRideAt,
  placesForServerFare,
  riderTierQuotes,
} from '../authoritativeFare.js'
import { resolveOfferedTier } from '../../shared/rideOptions.js'

const CLIENT_MONEY_KEYS = [
  'fareCents',
  'fare_cents',
  'fare',
  'depositCents',
  'deposit_cents',
  'deposit',
  'amount',
  'amountCents',
  'amount_cents',
  'total',
  'totalCents',
  'total_cents',
  'listCents',
  'list_cents',
  'isStudent',
  'is_student',
  'miles',
  'minutes',
  'distanceM',
  'durationS',
  'vehicleMultiplier',
  'isCarpool',
]

function withoutClientMoney(body) {
  const next = { ...(body || {}) }
  for (const key of CLIENT_MONEY_KEYS) delete next[key]
  return next
}

async function distanceBetween(origin, dest, compute) {
  if (!origin || !dest || origin.lat == null || dest.lat == null) {
    return { distanceM: null, durationS: null }
  }
  const route = await compute(origin, dest, [])
  if (route?.error) return { distanceM: null, durationS: null }
  return { distanceM: route.distanceM ?? null, durationS: route.durationS ?? null }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const clean = withoutClientMoney(body)
  const now = deps.now instanceof Date ? deps.now : new Date()
  const when = parseRideAt(clean, now)
  const located = placesForServerFare(clean)
  if (located.error) return json(res, 400, { error: located.error })

  const sb = deps.sb !== undefined ? deps.sb : admin()
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  let gameDayMultiplier = null
  let gameDayEvent = null
  if (sb) {
    try {
      const game = await loadGameDayMultiplier(sb, when)
      gameDayMultiplier = game.multiplier
      gameDayEvent = game.event
    } catch {
      gameDayMultiplier = null
      gameDayEvent = null
    }
  }

  let tier = 'standard'
  try {
    tier = resolveOfferedTier(clean.tier)
  } catch (error) {
    return json(res, error.status || 400, {
      error: error.message || 'That ride option is not offered.',
      code: error.code || 'ride_option_unavailable',
    })
  }

  const compute = deps.computeRoutes || computeRoutes
  const distance = await distanceBetween(located.pickup, located.dropoff, compute)
  const scheduled = Boolean(clean.date || clean.pickupAt || clean.scheduled_for || clean.scheduledFor)
  const priced = riderTierQuotes({
    pickup: located.pickup,
    dropoff: located.dropoff,
    airport: located.airport,
    at: when,
    now,
    isStudent: studentDiscountGranted(user),
    tier,
    gameDayMultiplier,
    distanceM: distance.distanceM,
    durationS: distance.durationS,
    scheduleAhead: scheduled,
  })
  const split = splitPlatformFee(priced.fareCents)
  const breakdown = priced.breakdown || priced.quote?.breakdown || {}

  return json(res, 200, {
    version: FARE_RATES_VERSION,
    routeSource: priced.routeSource,
    surge: priced.surge,
    gameDay: gameDayEvent
      ? {
          id: gameDayEvent.id ?? null,
          title: gameDayEvent.title ?? null,
          zone: gameDayEvent.pickup_zone_label ?? null,
        }
      : null,
    studentDiscountApplied: Boolean(priced.isStudent),
    estimate: Boolean(priced.estimate),
    airport: priced.airport,
    tier: priced.tier,
    fareCents: priced.fareCents,
    depositCents: priced.depositCents,
    discountCents: priced.discountCents,
    fareBeforeScheduleDiscountCents: priced.fareBeforeScheduleDiscountCents ?? priced.fareCents,
    scheduleDiscountPct: priced.scheduleDiscountPct || 0,
    scheduleDiscountCents: priced.scheduleDiscountCents || 0,
    scheduleDiscountApplied: Boolean(priced.scheduleDiscountApplied),
    tiers: priced.tiers,
    quote: {
      fareCents: priced.fareCents,
      cashCents: priced.fareCents,
      miles: priced.quote?.miles,
      minutes: priced.quote?.minutes,
      breakdown,
    },
    platformFeeCents: split.platformFeeCents,
    driverEarningsCents: split.driverEarningsCents,
  })
}
