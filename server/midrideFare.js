/**
 * Mid-ride cancellation fare.
 * Distinct from a wait-fee cancel at pickup (before the trip starts).
 *
 * obligation = min(quoted + cancelFee, ridePortion + cancelFee)
 * ridePortion = min(quoted, max(metered, progressShareOfQuoted))
 * metered    = base + perMile * miles + perMinute * minutes
 * progress   = max(distance along GPS / straight-line trip, elapsed / expected at 30 mph)
 *
 * Platform keeps 20% of the obligation; driver keeps the remaining 80%
 * (remainder after rounding so the two shares always sum to the obligation).
 * A succeeded deposit is credited against the card charge, not against the driver's share.
 */

export const MIDRIDE_STATUS = 'canceled_midride'

/** Statuses that mean the rider is already on the trip (not waiting at pickup). */
export const MIDRIDE_STATUSES = ['in_progress']

export const FARE_RATES = {
  baseCents: 250,
  perMileCents: 175,
  perMinuteCents: 35,
  cancelFeeCents: 500,
}

export const PLATFORM_RATE = 0.2
export const MIDRIDE_CANCEL_MAX = 3
export const MIDRIDE_CANCEL_WINDOW_DAYS = 30
export const CHARGE_CAP_CENTS = 50000
/** ~30 mph — used only when GPS progress is missing so a silent GPS cannot zero the fare. */
export const ASSUMED_METERS_PER_SECOND = 13.4112
const METERS_PER_MILE = 1609.344

export function readFareRates(env = process.env) {
  const fee = Number(env.MIDRIDE_CANCEL_FEE_CENTS)
  const max = Number(env.MIDRIDE_CANCEL_MAX)
  const days = Number(env.MIDRIDE_CANCEL_WINDOW_DAYS)
  return {
    rates: {
      ...FARE_RATES,
      cancelFeeCents: Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : FARE_RATES.cancelFeeCents,
    },
    maxCancels: Number.isFinite(max) && max >= 1 ? Math.round(max) : MIDRIDE_CANCEL_MAX,
    windowDays: Number.isFinite(days) && days >= 1 ? Math.round(days) : MIDRIDE_CANCEL_WINDOW_DAYS,
  }
}

export function haversineMeters(a, b) {
  if (!a || !b) return 0
  const lat1 = Number(a.lat)
  const lng1 = Number(a.lng)
  const lat2 = Number(b.lat)
  const lng2 = Number(b.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s1 = toRad(lat1)
  const s2 = toRad(lat2)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(s1) * Math.cos(s2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Sum of GPS segments. Teleports over 5 km are dropped so a glitch cannot inflate the fare. */
export function pathMeters(points) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const d = haversineMeters(points[i - 1], points[i])
    if (d > 0 && d < 5000) total += d
  }
  return total
}

export function splitObligation(obligationCents) {
  const obligation = Math.max(0, Math.round(Number(obligationCents) || 0))
  const platformCents = Math.round(obligation * PLATFORM_RATE)
  const driverCents = obligation - platformCents
  return { obligationCents: obligation, platformCents, driverCents }
}

export function abuseDecision(priorCount, max = MIDRIDE_CANCEL_MAX) {
  const count = Math.max(0, Math.round(Number(priorCount) || 0))
  const limit = Math.max(1, Math.round(Number(max) || MIDRIDE_CANCEL_MAX))
  return {
    priorCount: count,
    max: limit,
    remaining: Math.max(0, limit - count),
    blocked: count >= limit,
  }
}

/**
 * @param {object} input
 * @param {number} input.quotedFareCents booked fare (already student-discounted when applicable)
 * @param {number} input.distanceM meters traveled (GPS path or straight line from pickup)
 * @param {number} input.straightM pickup → dropoff meters
 * @param {number} input.durationS seconds since trip start
 * @param {number} [input.depositPaidCents] succeeded deposits/balances already captured
 * @param {object} [input.rates]
 */
export function quoteMidrideCancel(input = {}) {
  const rates = { ...FARE_RATES, ...(input.rates || {}) }
  const quoted = Math.max(0, Math.round(Number(input.quotedFareCents) || 0))
  const traveledM = Math.max(0, Number(input.distanceM) || 0)
  const straightM = Math.max(0, Number(input.straightM) || 0)
  const durationS = Math.max(0, Number(input.durationS) || 0)

  const miles = traveledM / METERS_PER_MILE
  const mins = durationS / 60
  const distanceCents = Math.max(0, Math.round(miles * rates.perMileCents))
  const timeCents = Math.max(0, Math.round(mins * rates.perMinuteCents))
  const baseCents = Math.max(0, Math.round(rates.baseCents))
  const meteredCents = baseCents + distanceCents + timeCents

  const distanceFraction = straightM > 50 ? Math.min(1, traveledM / straightM) : 0
  const expectedS = straightM > 50 ? straightM / ASSUMED_METERS_PER_SECOND : 0
  const elapsedFraction = expectedS > 0 ? Math.min(1, durationS / expectedS) : 0
  const fraction = Math.max(distanceFraction, elapsedFraction)
  const progressFareCents = Math.round(quoted * fraction)

  let ridePortionCents = Math.max(meteredCents, progressFareCents)
  if (quoted > 0) ridePortionCents = Math.min(quoted, ridePortionCents)

  const cancelFeeCents = Math.max(0, Math.round(Number(rates.cancelFeeCents) || 0))
  let obligationCents = ridePortionCents + cancelFeeCents
  if (quoted > 0) obligationCents = Math.min(obligationCents, quoted + cancelFeeCents)
  obligationCents = Math.min(CHARGE_CAP_CENTS, Math.max(0, obligationCents))

  const depositPaidCents = Math.max(0, Math.round(Number(input.depositPaidCents) || 0))
  const toCollectCents = Math.max(0, obligationCents - depositPaidCents)
  const split = splitObligation(obligationCents)

  return {
    quotedFareCents: quoted,
    distanceM: Math.round(traveledM),
    straightM: Math.round(straightM),
    durationS: Math.round(durationS),
    distanceFraction,
    elapsedFraction,
    fraction,
    meteredCents,
    baseCents,
    distanceCents,
    timeCents,
    progressFareCents,
    ridePortionCents,
    cancelFeeCents,
    obligationCents,
    depositPaidCents,
    toCollectCents,
    platformCents: split.platformCents,
    driverCents: split.driverCents,
    platformRate: PLATFORM_RATE,
    driverRate: 1 - PLATFORM_RATE,
    rates: {
      baseCents: rates.baseCents,
      perMileCents: rates.perMileCents,
      perMinuteCents: rates.perMinuteCents,
      cancelFeeCents,
    },
  }
}

/** Trip has left the pickup wait and is underway. Pre-start `arrived` / `arriving` belong to the wait-fee flow. */
export function isMidrideEligible(status, { started = false } = {}) {
  if (status === 'in_progress') return true
  if ((status === 'arriving' || status === 'arrived') && started) return true
  return false
}
