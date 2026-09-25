/**
 * What the rider should see for an unpaid airport-deposit hold.
 * Countdown copy comes from holdExpiry. A cancel stamped unpaid_hold_ttl
 * is the expired state, even when the local clock has not crossed the TTL yet.
 */
import { HOLD_EXPIRED_LABEL, holdRemaining } from './holdExpiry.js'
import { isUnpaidAirportDepositTrip } from './tripTags.js'

/** Rider countdown text refreshes on this cadence. The label itself is whole minutes. */
export const HOLD_COUNTDOWN_TICK_MS = 30_000

export const REQUEST_AGAIN_LABEL = 'Request again'

/** How long a TTL cancel stays on the deposit screen after the rider leaves and comes back. */
export const SURFACE_TTL_CANCEL_MS = 12 * 60 * 60 * 1000

/** Pool statuses the server sweep can still cancel. */
const OPEN_HOLD_STATUSES = new Set(['searching', 'offered', 'scheduled'])

function metaOf(trip) {
  return trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
}

/** Reason stored on the trip when checkout abandonment cancels the hold. */
export function unpaidHoldCancelReason(trip) {
  const reason = metaOf(trip).checkout_abandoned?.reason
  return typeof reason === 'string' ? reason : ''
}

export function isUnpaidHoldTtlCancel(trip) {
  if (!trip || typeof trip !== 'object') return false
  const status = String(trip.status || '').toLowerCase()
  if (status !== 'canceled' && status !== 'cancelled') return false
  return unpaidHoldCancelReason(trip) === 'unpaid_hold_ttl'
}

/** Still in the pool and waiting on the 25% card deposit. */
export function isOpenUnpaidAirportHold(trip) {
  if (!trip || typeof trip !== 'object') return false
  const status = String(trip.status || '').toLowerCase()
  if (!OPEN_HOLD_STATUSES.has(status)) return false
  return isUnpaidAirportDepositTrip(trip)
}

/** Open unpaid holds always surface. A TTL cancel surfaces for 12 hours after it was stamped. */
export function shouldSurfaceHold(trip, now = Date.now()) {
  if (isOpenUnpaidAirportHold(trip)) return true
  if (!isUnpaidHoldTtlCancel(trip)) return false
  const clock = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const at = metaOf(trip).checkout_abandoned?.at || trip?.canceled_at || trip?.created_at
  const ms = typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(ms)) return true
  return clock - ms < SURFACE_TTL_CANCEL_MS
}

export function holdAirportCode(trip) {
  const code = metaOf(trip).airport
  if (code === 'GSP' || code === 'CLT') return code
  return null
}

/**
 * @returns {{ mode: 'hidden' | 'countdown' | 'expired', label: string, requestAgain: boolean }}
 * hidden: not an open unpaid airport hold, and not a TTL cancel.
 * countdown: pay-within copy, including the last-minute sentence.
 * expired: the hold clock ran out, or the trip came back canceled as unpaid_hold_ttl.
 */
export function holdExpiryPresentation(trip, now = Date.now()) {
  if (isUnpaidHoldTtlCancel(trip)) {
    return { mode: 'expired', label: HOLD_EXPIRED_LABEL, requestAgain: true }
  }
  if (!isOpenUnpaidAirportHold(trip)) return { mode: 'hidden', label: '', requestAgain: false }
  const rem = holdRemaining(trip, now)
  if (!rem.label) return { mode: 'hidden', label: '', requestAgain: false }
  if (rem.expired) return { mode: 'expired', label: rem.label, requestAgain: true }
  return { mode: 'countdown', label: rem.label, requestAgain: false }
}
