/**
 * Server fare for checkout, trip rows, and collect/settle.
 * Student eligibility is studentDiscountGranted (confirmed @clemson.edu / @g.clemson.edu).
 * Client amount, fare_cents, total, and isStudent are not pricing inputs.
 */
import { airportCodeForPlace, tripMeters, ATL_FLOOR_CENTS } from '../src/lib/scheduledRideModel.js'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'
import {
  AIRPORT_ROUTE_FALLBACK,
  STUDENT_DISCOUNT_BPS,
  cardDepositCents,
  percentOffCents,
  quoteFare,
  resolveSurge,
  splitPlatformFee,
} from '../src/lib/fareRates.js'
import {
  amountDueForAction,
  paidTowardFareCents,
  readPrecomputedFeeCents,
} from '../shared/paymentFailure.js'

export const CAMPUS_PICKUP = { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }

export const AIRPORT_DROPOFFS = {
  GSP: { label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  CLT: { label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
}

const METERS_PER_MILE = 1609.344

export function parseRideAt(body, now = new Date()) {
  const fallback = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  if (body?.at) {
    const parsed = new Date(body.at)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  if (body?.pickupAt) {
    const parsed = new Date(body.pickupAt)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  if (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : '12:00'
    const parsed = new Date(`${body.date}T${time}:00`)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return fallback
}

function finiteCents(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

/**
 * Metered campus → GSP/CLT fare. Student 10% only when isStudent is already
 * decided by studentDiscountGranted. Deposit is 25% of that fare (no credits).
 */
export function quoteAirportCheckout({
  airport,
  at = new Date(),
  isStudent = false,
  gameDayMultiplier = null,
  distanceM = null,
  durationS = null,
} = {}) {
  const code = String(airport || 'GSP').toUpperCase() === 'CLT' ? 'CLT' : 'GSP'
  const fb = AIRPORT_ROUTE_FALLBACK[code]
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()
  const hasRoute = distanceM != null || durationS != null
  const surge = resolveSurge({ at: when, airport: true, gameDayMultiplier })
  const quote = quoteFare({
    distanceM: hasRoute ? distanceM : undefined,
    durationS: hasRoute ? durationS : undefined,
    miles: hasRoute ? undefined : fb.miles,
    minutes: hasRoute ? undefined : fb.minutes,
    surgeMultiplier: surge.multiplier,
    isStudent: Boolean(isStudent),
    isCarpool: false,
    tier: 'standard',
  })
  const fareCents = quote.fareBeforeCreditsCents
  return {
    airport: code,
    isStudent: Boolean(isStudent),
    fareCents,
    depositCents: cardDepositCents(fareCents),
    discountCents: quote.breakdown.student_discount_cents,
    surge,
    quote,
    routeSource: hasRoute ? 'google' : 'fallback',
    estimate: false,
  }
}

/**
 * Fare recorded on a scheduled or campus trip. GSP/CLT use the airport quote.
 * Other trips use the shared card on server distance. ATL keeps its existing floor.
 */
export function priceScheduledRequest({
  pickup,
  dropoff,
  airport = null,
  at = new Date(),
  isStudent = false,
  tier = 'standard',
  gameDayMultiplier = null,
  distanceM = null,
  durationS = null,
} = {}) {
  const explicit = airport ? String(airport).toUpperCase() : null
  const fromPlace = airportCodeForPlace(dropoff) || airportCodeForPlace(pickup)
  const code = explicit === 'GSP' || explicit === 'CLT' || explicit === 'ATL'
    ? explicit
    : fromPlace
  const tierId = tier === 'tesla' ? 'tesla' : 'standard'
  const student = Boolean(isStudent) && tierId === 'standard'
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()

  if (code === 'GSP' || code === 'CLT') {
    const priced = quoteAirportCheckout({
      airport: code,
      at: when,
      isStudent: student,
      gameDayMultiplier,
      distanceM,
      durationS,
    })
    return { ...priced, tier: tierId }
  }

  const hasRoute = distanceM != null || durationS != null
  let miles
  let minutes
  if (!hasRoute) {
    const meters = tripMeters(pickup, dropoff)
    miles = Math.max(0, (Number(meters) || 0) / METERS_PER_MILE)
    minutes = Math.max(8, Math.round(miles * 2.2))
  }
  const surge = resolveSurge({ at: when, airport: false, gameDayMultiplier })
  const quote = quoteFare({
    miles,
    minutes,
    distanceM: hasRoute ? distanceM : undefined,
    durationS: hasRoute ? durationS : undefined,
    surgeMultiplier: surge.multiplier,
    isStudent: false,
    tier: tierId,
  })
  let fareCents = quote.fareBeforeCreditsCents
  const floorApplied = code === 'ATL' && fareCents < ATL_FLOOR_CENTS
  if (floorApplied) fareCents = ATL_FLOOR_CENTS
  const studentOff = student
    ? percentOffCents(fareCents, STUDENT_DISCOUNT_BPS)
    : { amountCents: fareCents, discountCents: 0, bps: 0 }
  fareCents = studentOff.amountCents
  const split = splitPlatformFee(fareCents)
  return {
    airport: null,
    isStudent: student,
    fareCents,
    depositCents: 0,
    discountCents: studentOff.discountCents,
    surge,
    quote,
    tier: tierId,
    estimate: !hasRoute,
    routeSource: hasRoute ? 'google' : 'estimate',
    breakdown: {
      ...quote.breakdown,
      atl_floor_applied: floorApplied,
      student_discount_bps: studentOff.bps,
      student_discount_cents: studentOff.discountCents,
      fare_before_credits_cents: fareCents,
      rider_pays_cents: fareCents,
      platform_fee_cents: split.platformFeeCents,
      driver_earnings_cents: split.driverEarningsCents,
    },
  }
}

/** Checkout Session line amount. Client money fields cannot lower it. */
export function priceCheckoutBody({
  body = {},
  user = null,
  at = new Date(),
  gameDayMultiplier = null,
  distanceM = null,
  durationS = null,
} = {}) {
  const when = parseRideAt(body, at)
  const priced = quoteAirportCheckout({
    airport: body.airport,
    at: when,
    isStudent: studentDiscountGranted(user),
    gameDayMultiplier,
    distanceM,
    durationS,
  })
  const clientFare = finiteCents(body.fareCents ?? body.fare_cents ?? body.total ?? body.totalCents ?? body.total_cents)
  const clientCharge = finiteCents(
    body.depositCents ?? body.deposit_cents ?? body.amount ?? body.amountCents ?? body.amount_cents,
  )
  const clientUnderpaid = (clientFare != null && clientFare < priced.fareCents)
    || (clientCharge != null && clientCharge < priced.depositCents)
  return {
    ...priced,
    at: when,
    unitAmount: priced.depositCents,
    clientUnderpaid,
    spoofedStudent: body.isStudent === true && !priced.isStudent,
  }
}

export function airportTripRow({ user, priced, scheduledFor = null, riderFirst = 'Rider' }) {
  const code = priced.airport === 'CLT' ? 'CLT' : 'GSP'
  const dest = AIRPORT_DROPOFFS[code]
  const split = splitPlatformFee(priced.fareCents)
  const breakdown = priced.quote?.breakdown || priced.breakdown || {}
  return {
    rider_id: user.id,
    status: scheduledFor ? 'scheduled' : 'searching',
    tier: 'standard',
    pickup_label: CAMPUS_PICKUP.label,
    dropoff_label: dest.label,
    pickup_lat: CAMPUS_PICKUP.lat,
    pickup_lng: CAMPUS_PICKUP.lng,
    dropoff_lat: dest.lat,
    dropoff_lng: dest.lng,
    fare_cents: priced.fareCents,
    deposit_cents: priced.depositCents,
    platform_fee_cents: split.platformFeeCents,
    driver_earnings_cents: split.driverEarningsCents,
    surge_multiplier: priced.surge?.multiplier || 1,
    fare_breakdown: {
      ...breakdown,
      route_source: priced.routeSource || null,
      fare_source: 'server',
      rider_pays_cents: priced.fareCents,
    },
    passengers: 1,
    pickup_at: scheduledFor,
    scheduled_for: scheduledFor,
    rider_note: scheduledFor ? 'airport' : null,
    metadata: {
      kind: scheduledFor ? 'scheduled' : 'airport',
      purpose: 'airport',
      airport: code,
      rider_first_name: riderFirst,
      fare_is_estimate: false,
      reminders: {},
      isStudent: Boolean(priced.isStudent && priced.discountCents > 0),
      student_discount_cents: Math.max(0, Math.round(Number(priced.discountCents) || 0)),
      studentLabel: priced.discountCents > 0 ? 'Clemson student · 10% off Standard' : null,
      fare_source: 'server',
    },
  }
}

function sumSucceeded(payments, kinds) {
  return (payments || []).reduce((sum, row) => {
    if (row?.status !== 'succeeded') return sum
    const logical = row?.metadata?.logical_kind || row?.kind
    if (!kinds.has(logical)) return sum
    return sum + (Number(row.amount_cents) || 0)
  }, 0)
}

/**
 * Amount a public collect call may charge. Fare kinds use the trip row.
 * A client amountCents below that figure is ignored. Tips stay rider-chosen.
 */
export function serverCollectCents({ kind, trip, payments = [], clientAmountCents = null } = {}) {
  switch (kind) {
    case 'tip': {
      const cents = finiteCents(clientAmountCents)
      if (cents == null || cents < 0) return { error: 'amountCents required', status: 400 }
      return { amountCents: cents, source: 'client_tip', clientUnderpaid: false }
    }
    case 'credits_purchase':
      return { error: 'Credit packs are priced on the server', status: 400 }
    case 'wait_fee':
    case 'cancel_fee':
    case 'mid_ride': {
      if (!trip) return { error: 'tripId required', status: 400 }
      const pre = readPrecomputedFeeCents(trip, kind)
      if (pre == null) return { error: 'Fee is not computed yet', status: 409, code: 'fee_not_computed' }
      const client = finiteCents(clientAmountCents)
      return {
        amountCents: pre,
        source: 'server',
        clientUnderpaid: client != null && client < pre,
      }
    }
    case 'deposit': {
      if (!trip) return { error: 'tripId required', status: 400 }
      const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
      const stored = trip.deposit_cents == null || trip.deposit_cents === ''
        ? cardDepositCents(fare)
        : Math.max(0, Math.round(Number(trip.deposit_cents) || 0))
      const creditsApplied = Number(trip.fare_breakdown?.credits_debited_cents) > 0
        || trip.metadata?.credits_applied === true
      const floor = creditsApplied ? 0 : cardDepositCents(fare)
      const deposit = Math.min(fare, Math.max(stored, floor))
      const paid = sumSucceeded(payments, new Set(['deposit', 'airport_deposit']))
      const amountCents = Math.max(0, deposit - paid)
      const client = finiteCents(clientAmountCents)
      return {
        amountCents,
        source: 'server',
        clientUnderpaid: client != null && client < amountCents,
      }
    }
    case 'balance':
    case 'friend_ride_share': {
      if (!trip) return { error: 'tripId required', status: 400 }
      const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
      const paid = paidTowardFareCents(trip, payments)
      const amountCents = Math.max(0, fare - paid)
      const client = finiteCents(clientAmountCents)
      return {
        amountCents,
        source: 'server',
        clientUnderpaid: client != null && client < amountCents,
      }
    }
    default:
      return { error: 'Unsupported payment kind', status: 400 }
  }
}

/** Settle due amount. Client amountCents cannot replace the server figure. */
export function amountDueIgnoringClient({
  action,
  trip,
  payments = [],
  feeKind = null,
  clientAmountCents = null,
} = {}) {
  if (action !== 'complete' && action !== 'cancel' && action !== 'charge') {
    return { amountCents: null, code: null, clientUnderpaid: false }
  }
  const kind = feeKind || (action === 'cancel' ? 'cancel_fee' : action === 'charge' ? 'mid_ride' : 'balance')
  const due = amountDueForAction({
    action,
    fareCents: trip?.fare_cents,
    paidCents: paidTowardFareCents(trip, payments),
    hold: trip?.metadata?.payment_hold || null,
    explicitAmountCents: null,
    precomputedFeeCents: action === 'complete' ? null : readPrecomputedFeeCents(trip, kind),
    requireFee: action === 'charge',
  })
  const client = finiteCents(clientAmountCents)
  return {
    ...due,
    clientUnderpaid: client != null && due.amountCents != null && client < due.amountCents,
  }
}
