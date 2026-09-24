/**
 * Server fare for checkout, trip rows, and collect/settle.
 * Student eligibility is studentDiscountGranted (confirmed @clemson.edu / @g.clemson.edu).
 * Client amount, fare_cents, total, and isStudent are not pricing inputs.
 */
import { lookupCatalogPlace } from '../src/lib/placeCatalog.js'
import { AIRPORT_PLACES, airportCodeForPlace, tripMeters, ATL_FLOOR_CENTS } from '../src/lib/scheduledRideModel.js'
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
import { loadGameDayMultiplier } from './creditLots.js'

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

/** Finite fare already stored on the trip. Null, blank, and NaN are unset — not $0. */
export function storedFareCents(trip) {
  const raw = trip && typeof trip === 'object' ? trip.fare_cents : trip
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

function finiteCoord(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function canonicalAirportStop(code) {
  if (code === 'GSP' || code === 'CLT') return AIRPORT_DROPOFFS[code]
  if (code === 'ATL') {
    const place = AIRPORT_PLACES.find((row) => row.code === 'ATL')
    if (!place) return null
    return { label: place.label, lat: place.lat, lng: place.lng }
  }
  return null
}

function stopFromFields(label, lat, lng) {
  const name = String(label || '').trim().slice(0, 160)
  const catalog = name ? lookupCatalogPlace(name) : null
  const code = airportCodeForPlace({ label: name }) || airportCodeForPlace(catalog)
  if (code === 'GSP' || code === 'CLT' || code === 'ATL') return canonicalAirportStop(code)
  const la = finiteCoord(lat)
  const ln = finiteCoord(lng)
  if (name && la != null && ln != null) return { label: name, lat: la, lng: ln }
  if (catalog && Number.isFinite(Number(catalog.lat)) && Number.isFinite(Number(catalog.lng))) {
    return { label: catalog.label, lat: Number(catalog.lat), lng: Number(catalog.lng) }
  }
  return null
}

function stopFromTrip(trip, which) {
  if (which === 'pickup') return stopFromFields(trip?.pickup_label, trip?.pickup_lat, trip?.pickup_lng)
  return stopFromFields(trip?.dropoff_label, trip?.dropoff_lat, trip?.dropoff_lng)
}

/**
 * Places for a driver-requested trip. GSP, CLT, and ATL drop-offs use the
 * canonical airport pin so a short client coordinate cannot underprice the ride.
 */
export function resolveDriverRequestPlaces({
  pickupLabel = 'Memorial Stadium',
  pickupLat = null,
  pickupLng = null,
  dropoffLabel = 'GSP Airport',
  dropoffLat = null,
  dropoffLng = null,
  dest = null,
  destLat = null,
  destLng = null,
} = {}) {
  const dropoff = stopFromFields(dropoffLabel || dest || 'GSP Airport', dropoffLat ?? destLat, dropoffLng ?? destLng)
  let pickup = stopFromFields(pickupLabel || 'Memorial Stadium', pickupLat, pickupLng)
  const code = airportCodeForPlace(dropoff) || airportCodeForPlace(pickup)
  if ((code === 'GSP' || code === 'CLT' || code === 'ATL') && (!pickup || pickup.lat == null)) {
    pickup = CAMPUS_PICKUP
  }
  if (!pickup || !dropoff || pickup.lat == null || dropoff.lat == null) {
    return { error: 'Choose a pickup and a drop-off.' }
  }
  if (pickup.label === dropoff.label) return { error: 'Pickup and drop-off need to be different places.' }
  return {
    pickup,
    dropoff,
    airport: code === 'GSP' || code === 'CLT' || code === 'ATL' ? code : null,
  }
}

/** Server price for a driver request. Airport routes do not use a client distance. */
export function priceDriverRequest(places, {
  isStudent = false,
  at = new Date(),
  tier = 'standard',
  gameDayMultiplier = null,
  distanceM = null,
  durationS = null,
} = {}) {
  const airport = places?.airport === 'GSP' || places?.airport === 'CLT' ? places.airport : null
  const atl = places?.airport === 'ATL'
  return priceScheduledRequest({
    pickup: airport || atl ? CAMPUS_PICKUP : places.pickup,
    dropoff: airport ? AIRPORT_DROPOFFS[airport] : places.dropoff,
    airport,
    at,
    isStudent: Boolean(isStudent),
    tier: tier === 'tesla' ? 'tesla' : 'standard',
    gameDayMultiplier,
    distanceM,
    durationS,
  })
}

/**
 * Price a trip row that has no fare_cents yet.
 * GSP/CLT use the airport quote (published miles when no server route is passed).
 * ATL uses the canonical airport pin and the existing floor.
 * Other trips need stored coordinates. A missing route is not a $0 fare.
 */
export function priceRecordedTrip(trip, {
  isStudent = false,
  at = new Date(),
  gameDayMultiplier = null,
} = {}) {
  const pickup = stopFromTrip(trip, 'pickup')
  const dropoff = stopFromTrip(trip, 'dropoff')
  const code = airportCodeForPlace(dropoff) || airportCodeForPlace(pickup)
  const tier = trip?.tier === 'tesla' || trip?.metadata?.tesla === true ? 'tesla' : 'standard'
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()
  if (code === 'GSP' || code === 'CLT') {
    return {
      priced: priceScheduledRequest({
        pickup: CAMPUS_PICKUP,
        dropoff: AIRPORT_DROPOFFS[code],
        airport: code,
        at: when,
        isStudent: Boolean(isStudent),
        tier,
        gameDayMultiplier,
      }),
    }
  }
  const pricedPickup = code === 'ATL' ? CAMPUS_PICKUP : pickup
  const pricedDropoff = code === 'ATL' ? canonicalAirportStop('ATL') : dropoff
  if (!pricedPickup || !pricedDropoff || tripMeters(pricedPickup, pricedDropoff) == null) {
    return { error: 'Fare is not set. This trip has no server fare and no route.', code: 'fare_not_set' }
  }
  return {
    priced: priceScheduledRequest({
      pickup: pricedPickup,
      dropoff: pricedDropoff,
      at: when,
      isStudent: Boolean(isStudent),
      tier,
      gameDayMultiplier,
    }),
  }
}

export function fareRowPatch(trip, priced) {
  const split = splitPlatformFee(priced.fareCents)
  const previous = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const patch = {
    fare_cents: priced.fareCents,
    platform_fee_cents: split.platformFeeCents,
    driver_earnings_cents: split.driverEarningsCents,
    surge_multiplier: priced.surge?.multiplier || 1,
    fare_breakdown: {
      ...(priced.breakdown || priced.quote?.breakdown || {}),
      route_source: priced.routeSource || null,
      fare_source: 'server',
      rider_pays_cents: priced.fareCents,
    },
    metadata: {
      ...previous,
      fare_source: 'server',
      fare_is_estimate: Boolean(priced.estimate),
      isStudent: Boolean(priced.isStudent && priced.discountCents > 0),
      student_discount_cents: Math.max(0, Math.round(Number(priced.discountCents) || 0)),
      studentLabel: priced.discountCents > 0 ? 'Clemson student · 10% off Standard' : null,
      airport: priced.airport || null,
    },
  }
  if (trip?.deposit_cents == null || trip.deposit_cents === '') {
    patch.deposit_cents = priced.depositCents
  }
  return patch
}

const TRIP_FARE_SELECT = [
  'id', 'rider_id', 'driver_id', 'status', 'tier', 'fare_cents', 'deposit_cents',
  'pickup_label', 'dropoff_label', 'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
  'pickup_at', 'scheduled_for', 'requested_at', 'metadata', 'fare_breakdown',
  'platform_fee_cents', 'driver_earnings_cents',
].join(', ')

const TRIP_FARE_SELECT_NARROW = [
  'id', 'rider_id', 'driver_id', 'status', 'tier', 'fare_cents', 'deposit_cents',
  'pickup_label', 'dropoff_label', 'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
  'metadata',
].join(', ')

function rideAtFromTrip(trip, at) {
  if (at instanceof Date && !Number.isNaN(at.getTime())) return at
  const raw = trip?.pickup_at || trip?.scheduled_for || trip?.requested_at || trip?.created_at
  const parsed = raw ? new Date(raw) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

async function loadTripForFare(sb, id) {
  const full = await sb.from('trips').select(TRIP_FARE_SELECT).eq('id', id).maybeSingle()
  if (!full.error && full.data) return full.data
  if (full.error && /column|schema cache/i.test(full.error.message || '')) {
    const narrow = await sb.from('trips').select(TRIP_FARE_SELECT_NARROW).eq('id', id).maybeSingle()
    if (!narrow.error && narrow.data) return narrow.data
  }
  return null
}

/**
 * Persist a server fare on a trip whose fare_cents is still null.
 * A stored 0 stays 0. Student eligibility is the rider's confirmed Clemson email.
 */
export async function ensureAuthoritativeFare({ sb, trip, at = null } = {}) {
  if (!trip?.id) return { error: 'Trip not found', status: 404, code: 'fare_not_set' }
  let row = trip
  if (storedFareCents(row) != null) return { trip: row, filled: false }
  if (!sb) {
    return { error: 'Fare is not set. This trip cannot settle at $0.', status: 409, code: 'fare_not_set', trip: row }
  }

  const loaded = await loadTripForFare(sb, trip.id)
  if (loaded) row = { ...row, ...loaded }
  if (storedFareCents(row) != null) return { trip: row, filled: false }

  let rider = null
  if (sb.auth?.admin?.getUserById && row.rider_id) {
    try {
      const { data, error } = await sb.auth.admin.getUserById(row.rider_id)
      if (!error) rider = data?.user || null
    } catch {
      rider = null
    }
  }

  const when = rideAtFromTrip(row, at)
  let gameDayMultiplier = null
  try {
    const game = await loadGameDayMultiplier(sb, when)
    gameDayMultiplier = game?.multiplier ?? null
  } catch {
    gameDayMultiplier = null
  }

  const quoted = priceRecordedTrip(row, {
    isStudent: studentDiscountGranted(rider),
    at: when,
    gameDayMultiplier,
  })
  if (quoted.error || quoted.priced?.fareCents == null) {
    return {
      error: quoted.error || 'Fare is not set. This trip cannot settle at $0.',
      status: 409,
      code: 'fare_not_set',
      trip: row,
    }
  }

  const patch = fareRowPatch(row, quoted.priced)
  const updated = await sb.from('trips').update(patch).eq('id', row.id).is('fare_cents', null).select(TRIP_FARE_SELECT).maybeSingle()
  if (!updated.error && storedFareCents(updated.data) != null) {
    return { trip: updated.data, priced: quoted.priced, filled: true }
  }
  if (updated.error && /column|schema cache/i.test(updated.error.message || '')) {
    const narrowPatch = { fare_cents: patch.fare_cents, metadata: patch.metadata }
    if (patch.deposit_cents != null) narrowPatch.deposit_cents = patch.deposit_cents
    const retry = await sb.from('trips').update(narrowPatch).eq('id', row.id).is('fare_cents', null).select(TRIP_FARE_SELECT_NARROW).maybeSingle()
    if (!retry.error && storedFareCents(retry.data) != null) {
      return { trip: { ...row, ...retry.data }, priced: quoted.priced, filled: true }
    }
    if (retry.error && !/column|schema cache/i.test(retry.error.message || '')) {
      return { error: retry.error.message || 'Could not store fare', status: 500, code: 'fare_not_set' }
    }
  } else if (updated.error) {
    return { error: updated.error.message || 'Could not store fare', status: 500, code: 'fare_not_set' }
  }
  const again = await loadTripForFare(sb, row.id)
  if (storedFareCents(again) != null) return { trip: again, filled: false }
  return { error: 'Fare is not set. This trip cannot settle at $0.', status: 409, code: 'fare_not_set', trip: row }
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
      const fare = storedFareCents(trip)
      if (fare == null) return { error: 'Fare is not set. This trip cannot be charged as $0.', status: 409, code: 'fare_not_set' }
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
      const fare = storedFareCents(trip)
      if (fare == null) return { error: 'Fare is not set. This trip cannot be charged as $0.', status: 409, code: 'fare_not_set' }
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
