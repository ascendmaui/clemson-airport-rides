/**
 * Pure decisions for three matching edges.
 *
 * These do not expire stale offers and do not write SQL. The decline flags
 * match the rebroadcast sweep and the decline/offline release: the rider stays
 * searching, the declining driver is recorded as tried, and the next target
 * (or the open pool) is stamped on the same metadata object.
 */

const OPEN_OFFER_STATUSES = new Set(['searching', 'offered'])

function metadataOf(trip) {
  const meta = trip?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
}

function uniqueIds(values, extra) {
  const out = []
  for (const value of [...(Array.isArray(values) ? values : []), extra]) {
    if (typeof value !== 'string' || !value || out.includes(value)) continue
    out.push(value)
  }
  return out
}

function immediateDriverRequest(trip) {
  if (!trip || typeof trip !== 'object') return false
  if (metadataOf(trip).kind !== 'driver_request') return false
  if (trip.pickup_at || trip.scheduled_for) return false
  return Number(trip.deposit_cents || 0) === 0
}

/**
 * Rider cancel of a still-unassigned ride blocks a later accept of that offer.
 * A live searching or offered row is not blocked. A cancel after a driver was
 * assigned is a different path and returns false.
 * Missing trip data blocks the accept.
 */
export function searchingCancelBlocksLaterAccept(trip) {
  if (!trip || typeof trip !== 'object') return true
  const status = String(trip.status || '').toLowerCase()
  const unassigned = trip.driver_id == null || trip.driver_id === ''
  return unassigned && (status === 'canceled' || status === 'cancelled')
}

/**
 * Targeted decline of an immediate driver request. `nextDriverId` is the
 * already chosen eligible driver; this helper does not query presence.
 * A stale decline (the offer now points at someone else) does not move it.
 */
export function declineRebroadcastFlags(trip, {
  driverId,
  nextDriverId = null,
  now = new Date(),
} = {}) {
  const meta = metadataOf(trip)
  const unchanged = {
    applied: false,
    rebroadcast: false,
    status: trip?.status ?? null,
    driver_id: trip?.driver_id ?? null,
    metadata: meta,
  }
  if (!immediateDriverRequest(trip)) return unchanged
  if (!driverId || typeof driverId !== 'string') return unchanged
  if (trip.driver_id) return unchanged
  if (!OPEN_OFFER_STATUSES.has(trip.status)) return unchanged
  const target = typeof meta.offer_driver_id === 'string' ? meta.offer_driver_id : ''
  if (!target || target !== driverId) return unchanged

  const tried = uniqueIds(meta.offer_tried_driver_ids, driverId)
  const passed = uniqueIds(meta.offer_passed_driver_ids, driverId)
  const next = typeof nextDriverId === 'string'
    && nextDriverId
    && nextDriverId !== driverId
    && nextDriverId !== trip.rider_id
    && !tried.includes(nextDriverId)
    && !passed.includes(nextDriverId)
    ? nextDriverId
    : null
  const atDate = now instanceof Date ? now : new Date(now)
  const at = Number.isFinite(atDate.getTime()) ? atDate.toISOString() : new Date().toISOString()

  return {
    applied: true,
    rebroadcast: true,
    status: 'searching',
    driver_id: null,
    metadata: {
      ...meta,
      offer_driver_id: next,
      offer_tried_driver_ids: tried,
      offer_passed_driver_ids: passed,
      offer_release_reason: 'driver_decline',
      offer_rebroadcast_reason: 'driver_decline',
      offer_released_at: at,
      match: next ? 'auto' : 'open',
    },
  }
}

/** An offline driver does not keep a searching or offered card. */
export function activeOfferCard({ online, card } = {}) {
  if (online !== true) return null
  if (!card || typeof card !== 'object') return null
  if (!OPEN_OFFER_STATUSES.has(card.status)) return null
  return card
}

export const OFFLINE_WHILE_OFFERED_MESSAGE = 'You are offline. This offer is no longer on your card.'

/** Copy for the moment a driver goes offline while a live offer card is up. */
export function offlineWhileOfferedMessage({ online, card } = {}) {
  if (online === true) return null
  if (!card || typeof card !== 'object') return null
  if (!OPEN_OFFER_STATUSES.has(card.status)) return null
  return OFFLINE_WHILE_OFFERED_MESSAGE
}
