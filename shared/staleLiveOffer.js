/**
 * Unassigned `offered` trips stop being a Live offer once their dispatch
 * deadline has passed, or after STALE_LIVE_OFFER_TTL_MS with no deadline.
 * Targeted driver_request rows still belong to matching rebroadcast.
 */

export const STALE_LIVE_OFFER_TTL_MS = 15 * 60 * 1000

function parsedMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function resolveNow(now) {
  if (now == null) return Date.now()
  return parsedMs(now) ?? Date.now()
}

function metaOf(trip) {
  return trip?.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
    ? trip.metadata
    : {}
}

/** Request time, then insert time. Missing both means the age rule cannot fire. */
export function liveOfferAnchorMs(trip) {
  return parsedMs(trip?.requested_at) ?? parsedMs(trip?.created_at)
}

/**
 * True when this row must not render as a Live offer.
 * A set offer_expires_at wins over the 15-minute age, including a future window.
 */
export function isStaleLiveOffer(trip, now = Date.now(), ttlMs = STALE_LIVE_OFFER_TTL_MS) {
  if (!trip || trip.status !== 'offered' || trip.driver_id) return false
  const nowMs = resolveNow(now)
  const expires = parsedMs(trip.offer_expires_at)
  if (expires != null) return nowMs >= expires
  const anchor = liveOfferAnchorMs(trip)
  if (anchor == null) return false
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : STALE_LIVE_OFFER_TTL_MS
  return nowMs - anchor >= ttl
}

/** Immediate campus offers the minute rebroadcast sweep still advances. */
export function rebroadcastOwnsOffer(trip) {
  const meta = metaOf(trip)
  return meta.kind === 'driver_request'
    && Boolean(meta.offer_driver_id)
    && Number(trip?.deposit_cents || 0) === 0
    && !trip?.pickup_at
    && !trip?.scheduled_for
}

export function futureSchedule(trip, now = Date.now()) {
  const nowMs = resolveNow(now)
  const pickup = parsedMs(trip?.pickup_at)
  const scheduled = parsedMs(trip?.scheduled_for)
  return (pickup != null && pickup > nowMs) || (scheduled != null && scheduled > nowMs)
}

export function paymentHoldBlocksCancel(trip) {
  const hold = metaOf(trip).payment_hold
  return Boolean(hold && typeof hold === 'object' && hold.status === 'payment_required')
}
