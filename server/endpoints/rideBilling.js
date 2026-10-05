/**
 * POST /api/stripe-payment-methods?action=billing
 * mode=quote prices the ride and returns how it can be paid.
 * mode=record stores the rider's choice on a trip.
 * Client fare, deposit, amount, total, and isStudent are ignored.
 * Recording a choice does not spend credits and does not charge a card.
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import { loadGameDayMultiplier } from '../creditLots.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { depositSplit, splitPlatformFee } from '../../src/lib/fareRates.js'
import { firstName } from '../../src/lib/scheduledRideModel.js'
import {
  parseRideAt,
  placesForServerFare,
  priceScheduledRequest,
} from '../authoritativeFare.js'
import {
  billingForPricedRide,
  billingOffer,
  readRideCreditBalance,
} from '../rideBilling.js'

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
  'isStudent',
  'is_student',
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

async function priceBody(sb, user, body, compute, now) {
  const clean = withoutClientMoney(body)
  const when = parseRideAt(clean, now)
  let gameDayMultiplier = null
  try {
    const game = await loadGameDayMultiplier(sb, when)
    gameDayMultiplier = game.multiplier
  } catch {
    gameDayMultiplier = null
  }
  const isStudent = studentDiscountGranted(user)
  const located = placesForServerFare(clean)
  if (located.error) return { error: located.error, status: 400 }
  const { pickup, dropoff, airport } = located
  const distance = await distanceBetween(pickup, dropoff, compute)
  const tier = clean.tier === 'tesla' ? 'tesla' : 'standard'
  const priced = priceScheduledRequest({
    pickup,
    dropoff,
    airport,
    at: when,
    isStudent,
    tier,
    gameDayMultiplier,
    distanceM: distance.distanceM,
    durationS: distance.durationS,
  })
  return { priced, pickup, dropoff, when, clean }
}

function quotePayload(priced, balance) {
  const split = depositSplit(priced.fareCents, priced.depositCents)
  const offer = billingOffer({
    fareCents: priced.fareCents,
    depositCents: priced.depositCents,
    balanceCents: balance.balanceCents,
    balanceKnown: balance.known,
    airport: priced.airport,
  })
  return {
    fareCents: offer.fareCents,
    depositCents: offer.depositCents,
    remainingCents: split.remainingCents,
    discountCents: Math.max(0, Math.round(Number(priced.discountCents) || 0)),
    balanceCents: offer.balanceCents,
    balanceKnown: offer.balanceKnown,
    airport: offer.airport,
    campus: offer.campus,
    creditsSelectable: offer.creditsSelectable,
    options: offer.options,
    charged: false,
    debitedCents: 0,
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
  const compute = deps.computeRoutes || computeRoutes
  const now = deps.now instanceof Date ? deps.now : new Date()

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const mode = body.mode === 'record' ? 'record' : body.mode === 'quote' ? 'quote' : null
  if (!mode) return json(res, 400, { error: 'mode must be quote or record' })

  const pricedResult = await priceBody(sb, user, body, compute, now)
  if (pricedResult.error) return json(res, pricedResult.status || 400, { error: pricedResult.error })
  const { priced, pickup, dropoff, when } = pricedResult
  if (priced?.fareCents == null || !Number.isFinite(Number(priced.fareCents))) {
    return json(res, 409, { error: 'Fare is not set', code: 'fare_not_set' })
  }

  const balance = await readRideCreditBalance(sb, user.id)
  const quote = quotePayload(priced, balance)
  if (mode === 'quote') return json(res, 200, quote)

  const billing = await billingForPricedRide(sb, user.id, body, priced)
  if (billing.error) {
    return json(res, billing.error.status || 409, {
      error: billing.error.error,
      code: billing.error.code,
      fareCents: quote.fareCents,
      depositCents: quote.depositCents,
      balanceCents: quote.balanceCents,
      creditsSelectable: quote.creditsSelectable,
      charged: false,
      debitedCents: 0,
    })
  }
  if (!billing.snapshot.billing_choice) {
    return json(res, 400, { error: 'Choose how this ride will be paid.', code: 'billing_choice_required' })
  }

  const profileRes = await runEnsureProfile(sb, user)
  if (!profileRes?.ok) {
    return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
  }

  const split = splitPlatformFee(priced.fareCents)
  const scheduledFor = body.date || body.pickupAt ? when.toISOString() : null
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  const row = {
    rider_id: user.id,
    driver_id: null,
    status: scheduledFor ? 'scheduled' : 'searching',
    tier: priced.tier === 'tesla' ? 'tesla' : 'standard',
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
    passengers: 1,
    pickup_at: scheduledFor,
    scheduled_for: scheduledFor,
    metadata: {
      kind: priced.airport ? (scheduledFor ? 'scheduled' : 'airport') : 'driver_request',
      purpose: priced.airport ? 'airport' : 'planned',
      airport: priced.airport,
      fare_source: 'server',
      rider_first_name: riderFirst,
      isStudent: Boolean(priced.isStudent && priced.discountCents > 0),
      student_discount_cents: Math.max(0, priced.discountCents || 0),
      ...billing.snapshot,
    },
  }

  const inserted = await sb.from('trips').insert(row).select('id, status, fare_cents, deposit_cents, metadata').single()
  if (inserted.error || !inserted.data) {
    return json(res, 500, { error: inserted.error?.message || 'Could not record billing choice' })
  }

  return json(res, 200, {
    ...quote,
    trip: inserted.data,
    choice: billing.snapshot.billing_choice,
    charged: false,
    debitedCents: 0,
  })
}
