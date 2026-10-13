/**
 * Decide whether the driver should drop a locally held active trip.
 * A rider-app crash does not clear the trip: the server row stays active
 * until a timeout or the driver ends it.
 */

export const ACTIVE_TRIP_RECONCILE_MS = 15000

export const CLEAR_TRIP_STATUSES = Object.freeze([
  'canceled',
  'cancelled',
  'canceled_midride',
  'cancelled_wait',
  'completed',
  'expired',
])

function metaOf(trip) {
  const meta = trip?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
}

/**
 * Why the server copy must leave the driver's active screen.
 * `cancelled`, `completed`, and `expired` are the only clear reasons.
 * A still-active row returns null.
 */
export function tripTerminalClearReason(trip) {
  if (!trip || typeof trip !== 'object') return null
  const status = String(trip.status || '').toLowerCase()
  if (status === 'completed') return 'completed'
  if (status === 'expired') return 'expired'
  if (status === 'canceled' || status === 'cancelled' || status === 'canceled_midride' || status === 'cancelled_wait') {
    return 'cancelled'
  }
  const meta = metaOf(trip)
  if (meta.expired === true || meta.stale_abandoned === true || meta.cancel_reason === 'stale_abandoned') {
    return 'expired'
  }
  return null
}

/**
 * Compare the driver's local active trip with a successful server read.
 * `server === null` means the read succeeded and the row is gone, not a
 * network failure. Callers keep the local trip when the read throws.
 */
export function reconcileActiveTrip(local, server) {
  if (!local?.id) return { action: 'none', reason: null, trip: null }
  if (!server || server.id !== local.id) {
    return { action: 'clear', reason: 'expired', trip: null }
  }
  const reason = tripTerminalClearReason(server)
  if (reason) return { action: 'clear', reason, trip: server }
  return { action: 'keep', reason: null, trip: server }
}
