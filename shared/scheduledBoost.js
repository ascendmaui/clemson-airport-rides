/**
 * Upfront driver boost on a scheduled ride.
 * Distinct from the post-trip tip (trips.tip_cents). The rider adds this
 * before a driver accepts. It is held with the fare and captured at trip end.
 *
 * John: BOOST_DRIVER_SHARE_BPS is the driver split. 10000 means 100% of the
 * boost goes to the driver and none of it is in the platform commission.
 * Change this one constant to revise the split.
 */
import { fareAuthorizationCents } from './fareAuthorization.js'

/** Driver share of the boost, in basis points. 10000 = 100%. John: confirm. */
export const BOOST_DRIVER_SHARE_BPS = 10000

/** Hard cap for one scheduled ride. Single source for API, UI, and the DB check. */
export const BOOST_MAX_CENTS = 10000

/** Quick-add amounts shown before the ride is posted. */
export const BOOST_PRESETS_CENTS = Object.freeze([500, 1000, 1500, 2000])

/**
 * In-app nudge when a scheduled ride is still unaccepted inside this window.
 * A push notification is a follow-up; this only drives the rider card.
 */
export const BOOST_NUDGE_LEAD_MS = 2 * 60 * 60 * 1000

export const BOOST_RIDER_COPY = 'Add a boost to get matched faster — 100% goes to your driver.'

const UNACCEPTED = new Set(['scheduled', 'searching', 'offered'])

function roundCents(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

/** Stored amounts are never negative and never above the cap, even on old rows. */
export function clampBoostCents(value) {
  const cents = roundCents(value)
  if (cents == null || cents <= 0) return 0
  return Math.min(BOOST_MAX_CENTS, cents)
}

/**
 * Validate a boost the rider is setting, in cents.
 * Empty means no boost. Over the cap and negatives are rejected, not clamped.
 */
export function parseBoostCents(raw) {
  if (raw == null || raw === '') return { ok: true, cents: 0 }
  const n = typeof raw === 'string' ? Number(String(raw).trim()) : Number(raw)
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a boost amount.' }
  const cents = Math.round(n)
  if (Math.abs(n - cents) > 1e-6) return { ok: false, error: 'Enter a whole-cent amount.' }
  if (cents < 0) return { ok: false, error: 'Boost cannot be negative.' }
  if (cents > BOOST_MAX_CENTS) {
    return { ok: false, error: `Boost cannot be more than ${formatBoostDollars(BOOST_MAX_CENTS)}.` }
  }
  return { ok: true, cents }
}

/** Dollar field ("10", "10.50", "$12") to cents, then the same cap rules. */
export function parseBoostDollars(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, cents: 0 }
  const n = Number(String(raw).trim().replace(/^\$/, ''))
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a boost amount.' }
  return parseBoostCents(Math.round(n * 100))
}

/** A later bump can only raise the boost, up to the same cap. */
export function parseBoostBump(raw, currentCents) {
  const parsed = parseBoostCents(raw)
  if (!parsed.ok) return parsed
  const current = clampBoostCents(currentCents)
  if (parsed.cents <= current) {
    return { ok: false, error: 'Raise the boost above the current amount.' }
  }
  return parsed
}

export function formatBoostDollars(cents) {
  const amount = Math.max(0, Math.round(Number(cents) || 0))
  const dollars = amount / 100
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

/** Orange badge copy, e.g. "+$10 boost". */
export function formatBoostBadge(cents) {
  return `+${formatBoostDollars(cents)} boost`
}

/** Column when the migration is applied, otherwise metadata. Never the post-trip tip. */
export function readBoostCents(trip) {
  if (!trip || typeof trip !== 'object') return 0
  if (Object.prototype.hasOwnProperty.call(trip, 'boost_cents') && trip.boost_cents != null && trip.boost_cents !== '') {
    return clampBoostCents(trip.boost_cents)
  }
  if (Object.prototype.hasOwnProperty.call(trip, 'boostCents') && trip.boostCents != null && trip.boostCents !== '') {
    return clampBoostCents(trip.boostCents)
  }
  const meta = trip.metadata
  if (meta && typeof meta === 'object') {
    if (meta.boost_cents != null && meta.boost_cents !== '') return clampBoostCents(meta.boost_cents)
    if (meta.boostCents != null && meta.boostCents !== '') return clampBoostCents(meta.boostCents)
  }
  return 0
}

/** Driver portion of the boost. The rest, if any, stays with the platform. */
export function driverBoostShareCents(boostCents) {
  const boost = clampBoostCents(boostCents)
  const bps = Math.max(0, Math.min(10000, Math.round(Number(BOOST_DRIVER_SHARE_BPS) || 0)))
  return Math.round((boost * bps) / 10000)
}

export function platformBoostShareCents(boostCents) {
  return clampBoostCents(boostCents) - driverBoostShareCents(boostCents)
}

/**
 * Fare net (already after the ride commission) plus the driver boost share.
 * The boost is not run through the platform fee.
 */
export function driverPayoutWithBoost(fareNetCents, boostCents) {
  const fareNet = Math.max(0, Math.round(Number(fareNetCents) || 0))
  return fareNet + driverBoostShareCents(boostCents)
}

/**
 * Stripe manual-capture amount: estimated fare + buffer + boost.
 * The buffer stays a percent of the estimate only. The boost is added in full.
 * A $0 estimate with a boost still authorizes the boost.
 */
export function holdQuoteCents(estimatedFareCents, boostCents = 0) {
  const boost = clampBoostCents(boostCents)
  const base = fareAuthorizationCents(estimatedFareCents)
  return {
    estimatedFareCents: base.estimatedFareCents,
    bufferCents: base.bufferCents,
    boostCents: boost,
    authorizationCents: base.authorizationCents + boost,
  }
}

/** Amount captured at trip end: the fare due on the card, plus the full boost. */
export function captureCentsWithBoost(fareDueCents, boostCents = 0) {
  const fare = Math.max(0, Math.round(Number(fareDueCents) || 0))
  return fare + clampBoostCents(boostCents)
}

export function boostIsEditable(trip) {
  if (!trip || trip.driver_id) return false
  return UNACCEPTED.has(trip.status)
}

/**
 * Gentle in-app nudge. Null when a driver is assigned, the pickup is not
 * inside the lead window, or the ride is not still open.
 */
export function boostNudge(trip, now = new Date()) {
  if (!boostIsEditable(trip)) return null
  const when = trip.pickup_at || trip.scheduled_for || trip.pickupAt || trip.metadata?.scheduled_pickup_at
  if (!when) return null
  const until = new Date(when).getTime() - (now instanceof Date ? now.getTime() : new Date(now).getTime())
  if (!Number.isFinite(until) || until <= 0 || until > BOOST_NUDGE_LEAD_MS) return null
  const boost = readBoostCents(trip)
  if (boost > 0) {
    return {
      id: 'bump',
      body: 'No driver yet. Raise the boost to get matched faster — 100% goes to your driver.',
    }
  }
  return {
    id: 'add',
    body: 'No driver yet. Add a boost to get matched faster — 100% goes to your driver.',
  }
}

/** Higher boosts first, then earlier pickups. Ride type does not matter. */
export function compareBoostedFirst(a, b) {
  const boostA = readBoostCents(a)
  const boostB = readBoostCents(b)
  if (boostA !== boostB) return boostB - boostA
  const timeA = Date.parse(a?.pickupAt || a?.pickup_at || a?.scheduled_for || '')
  const timeB = Date.parse(b?.pickupAt || b?.pickup_at || b?.scheduled_for || '')
  const left = Number.isFinite(timeA) ? timeA : Number.POSITIVE_INFINITY
  const right = Number.isFinite(timeB) ? timeB : Number.POSITIVE_INFINITY
  if (left !== right) return left - right
  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

export function boostMetadata(boostCents) {
  const boost = clampBoostCents(boostCents)
  const driverCents = driverBoostShareCents(boost)
  return {
    boost_cents: boost,
    boost_driver_cents: driverCents,
    boost_platform_cents: boost - driverCents,
    boost_driver_share_bps: BOOST_DRIVER_SHARE_BPS,
  }
}

export function boostColumnMissing(error) {
  const message = String(error?.message || '')
  return /boost_cents/i.test(message) && /column|schema cache|does not exist|could not find/i.test(message)
}
