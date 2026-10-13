/**
 * POST /api/airport-checkout
 * Quotes the metered airport fare (surge + student) and books the trip.
 * No upfront deposit and no Schedule card hold. A fare fully covered by
 * ride credits is debited now. Any card fare is charged when the trip ends.
 * Platform 20% is stored on the trip from the full rider price.
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import {
  loadGameDayMultiplier, planSettlement, debitLots, insertChargePayment,
} from '../creditLots.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { quoteAirportCheckout } from '../authoritativeFare.js'
import { tigerPassBpsForRider } from '../riderPass.js'
import { tigerPassMetadata } from '../../shared/tigerPass.js'
import { splitPlatformFee } from '../../src/lib/fareRates.js'
import { flightFromBody } from '../../shared/airportContext.js'

const CAMPUS = { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }
const AIRPORTS = {
  GSP: { label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  CLT: { label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (!res.headersSent) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
  }
  if (req.method !== 'POST') {
    if (!res.headersSent) res.setHeader('Allow', 'POST, OPTIONS')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const userFromAuthFn = deps.userFromAuth || userFromAuth
  const user = deps.user !== undefined ? deps.user : await userFromAuthFn(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const runEnsureProfile = deps.ensureProfile || ensureProfile

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const rawAirport = body?.airport || 'GSP'
  const airport = (typeof rawAirport === 'string' ? rawAirport.trim() : String(rawAirport || 'GSP').trim()).toUpperCase()
  const dest = AIRPORTS[airport]
  if (!dest) return json(res, 400, { error: 'Unknown airport' })
  // Optional rider flight (number + time) for the driver's airport context.
  const flightInput = flightFromBody(body)
  if (flightInput.error) return json(res, 400, { error: flightInput.error, code: flightInput.code })

  let scheduledFor = null
  let at = new Date()
  if (body?.date) {
    const hhmm = body.time || '12:00'
    const parsed = new Date(`${body.date}T${hhmm}:00`)
    if (!Number.isNaN(parsed.getTime())) {
      scheduledFor = parsed.toISOString()
      at = parsed
    }
  }

  const isStudent = deps.studentDiscountGranted ? deps.studentDiscountGranted(user) : studentDiscountGranted(user)
  const tigerPassBpsFn = deps.tigerPassBpsForRider || tigerPassBpsForRider
  const tigerPassBps = await tigerPassBpsFn(sb, user.id, at)

  let distanceM = null
  let durationS = null
  let routeSource = 'fallback'
  const computeRoutesFn = deps.computeRoutes || computeRoutes
  const route = await computeRoutesFn(CAMPUS, dest, [])
  if (!route?.error) {
    distanceM = route.distanceM
    durationS = route.durationS
    routeSource = 'google'
  }
  const loadGameDayMultiplierFn = deps.loadGameDayMultiplier || loadGameDayMultiplier
  const game = await loadGameDayMultiplierFn(sb, at)
  const quoteAirportCheckoutFn = deps.quoteAirportCheckout || quoteAirportCheckout
  const priced = quoteAirportCheckoutFn({
    airport,
    at,
    isStudent,
    gameDayMultiplier: game.multiplier,
    distanceM,
    durationS,
    tigerPassBps,
  })
  const quoted = priced.quote
  const surge = priced.surge

  const useCredits = body?.useCredits !== false
  const planSettlementFn = deps.planSettlement || planSettlement
  const settlement = await planSettlementFn(sb, {
    profileId: user.id,
    fareCents: quoted.fareBeforeCreditsCents,
    useCredits,
  })
  const coveredByCredits = settlement.cashCents <= 0 && settlement.creditsDebitedCents > 0
  const fareCents = coveredByCredits ? settlement.riderPaysCents : quoted.fareBeforeCreditsCents
  const fareSplit = splitPlatformFee(fareCents)

  const profileRes = await runEnsureProfile(sb, user)
  if (!profileRes?.ok) {
    return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
  }

  const { data: trip, error: tripErr } = await sb
    .from('trips')
    .insert({
      rider_id: user.id,
      status: scheduledFor ? 'scheduled' : 'searching',
      tier: 'standard',
      pickup_label: CAMPUS.label,
      dropoff_label: dest.label,
      pickup_lat: CAMPUS.lat,
      pickup_lng: CAMPUS.lng,
      dropoff_lat: dest.lat,
      dropoff_lng: dest.lng,
      fare_cents: fareCents,
      deposit_cents: 0,
      platform_fee_cents: fareSplit.platformFeeCents,
      driver_earnings_cents: fareSplit.driverEarningsCents,
      surge_multiplier: surge.multiplier,
      fare_breakdown: {
        ...quoted.breakdown,
        route_source: routeSource,
        surge_rule: surge.rule?.id || null,
        surge_label: surge.rule?.label || null,
        credits_debited_cents: settlement.creditsDebitedCents,
        credit_discount_cents: settlement.creditDiscountCents,
        cash_cents: settlement.cashCents,
        rider_pays_cents: settlement.riderPaysCents,
      },
      passengers: 1,
      ...(flightInput.column ? { flight: flightInput.column } : {}),
      pickup_at: scheduledFor,
      scheduled_for: scheduledFor,
      metadata: {
        kind: scheduledFor ? 'scheduled' : 'airport',
        airport,
        ...(flightInput.flight ? { flight: flightInput.flight } : {}),
        pending_credit_debits: [],
        credits_applied: coveredByCredits,
        due_at_trip_end_cents: coveredByCredits ? 0 : fareCents,
        ...tigerPassMetadata(priced),
      },
    })
    .select('id')
    .single()
  if (tripErr) return json(res, 500, { error: tripErr.message || 'Could not create trip' })

  if (coveredByCredits) {
    try {
      const debitLotsFn = deps.debitLots || debitLots
      await debitLotsFn(sb, {
        profileId: user.id,
        debits: settlement.debits,
        note: `airport:${trip.id}`,
        tripId: trip.id,
      })
      const insertChargePaymentFn = deps.insertChargePayment || insertChargePayment
      await insertChargePaymentFn(sb, {
        riderId: user.id,
        tripId: trip.id,
        kind: 'ride_fare',
        amountCents: settlement.creditsDebitedCents,
        metadata: { method: 'credits', airport, discount_cents: settlement.creditDiscountCents },
      })
    } catch (err) {
      await sb.from('trips').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', trip.id)
      return json(res, 409, { error: err.message || 'Could not spend credits' })
    }
  }

  return json(res, 200, {
    paidWithCredits: coveredByCredits,
    charged: false,
    tripId: trip.id,
    airport,
    fareCents,
    depositCents: 0,
    dueAtTripEndCents: coveredByCredits ? 0 : fareCents,
    studentDiscountApplied: isStudent,
    platformFeeCents: fareSplit.platformFeeCents,
    driverEarningsCents: fareSplit.driverEarningsCents,
    surge,
    routeSource,
    currency: 'usd',
  })
}
