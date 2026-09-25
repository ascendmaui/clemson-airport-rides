/**
 * Rider countdown for an unpaid airport-deposit hold.
 * The hold starts at the later of created_at and metadata.stripe_checkout_created_at,
 * the same anchor the server uses before it cancels with reason unpaid_hold_ttl.
 * msLeft <= 0 is expired, matching now - anchor >= ttl.
 */
import { UNPAID_AIRPORT_HOLD_TTL_MS } from '../../shared/airportHold.js'

export { UNPAID_AIRPORT_HOLD_TTL_MS }

export const HOLD_EXPIRED_LABEL = 'This hold expired — request again'
export const HOLD_LAST_MINUTE_LABEL = 'Less than a minute left'

function parsedMs(value) {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function metaObject(trip) {
  return trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
}

/** Later of trip insert and Checkout session bind. */
function holdStartMs(trip) {
  const created = parsedMs(trip?.created_at)
  const session = parsedMs(metaObject(trip).stripe_checkout_created_at)
  if (created == null) return session
  if (session == null) return created
  return Math.max(created, session)
}

function finiteTtl(ttlMs) {
  if (typeof ttlMs === 'number' && Number.isFinite(ttlMs)) return ttlMs
  return UNPAID_AIRPORT_HOLD_TTL_MS
}

function resolveNow(now) {
  if (now == null) return Date.now()
  if (now instanceof Date) {
    const ms = now.getTime()
    return Number.isFinite(ms) ? ms : Date.now()
  }
  if (typeof now === 'number' && Number.isFinite(now)) return now
  if (typeof now === 'string' && now) {
    const ms = Date.parse(now)
    if (Number.isFinite(ms)) return ms
  }
  return Date.now()
}

/**
 * Whole minutes are floored so the label never claims more minutes than remain.
 * Under one minute uses its own sentence. Zero and negative remaining are expired.
 */
function holdLabel(msLeft) {
  if (msLeft <= 0) return HOLD_EXPIRED_LABEL
  if (msLeft < 60_000) return HOLD_LAST_MINUTE_LABEL
  const minutes = Math.floor(msLeft / 60_000)
  return `Pay within ${minutes} min to keep your ride`
}

/** Epoch ms when the hold ends, or null when the trip has no start time. */
export function holdDeadline(trip, ttlMs = UNPAID_AIRPORT_HOLD_TTL_MS) {
  const start = holdStartMs(trip)
  if (start == null) return null
  return start + finiteTtl(ttlMs)
}

/**
 * @returns {{ msLeft: number | null, expired: boolean, label: string }}
 * msLeft is null when created_at and the Checkout bind time are both missing.
 * A negative msLeft is how far past the deadline the clock is.
 */
export function holdRemaining(trip, now = Date.now(), ttlMs = UNPAID_AIRPORT_HOLD_TTL_MS) {
  const deadline = holdDeadline(trip, ttlMs)
  if (deadline == null) return { msLeft: null, expired: false, label: '' }
  const msLeft = deadline - resolveNow(now)
  return { msLeft, expired: msLeft <= 0, label: holdLabel(msLeft) }
}
