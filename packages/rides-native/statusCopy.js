/**
 * Unified ride status copy normalization across mobile and web platforms.
 * Provides canonical status keys, user-visible labels, badge tones, and title headers.
 */

export const CANONICAL_TRIP_STATUSES = Object.freeze([
  'searching',
  'offered',
  'requested',
  'scheduled',
  'accepted',
  'arriving',
  'arrived',
  'in_progress',
  'completed',
  'canceled',
  'cancelled_wait',
  'canceled_midride',
])

/**
 * Normalizes input status strings across variations (casing, hyphens, British spelling).
 *
 * @param {unknown} raw - Raw status string or input
 * @returns {string} Normalized status code
 */
export function normalizeTripStatus(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const cleaned = raw.trim().toLowerCase().replace(/-/g, '_')
  if (cleaned === 'cancelled') return 'canceled'
  if (cleaned === 'cancelled_midride') return 'canceled_midride'
  if (cleaned === 'canceled_wait') return 'cancelled_wait'
  if (cleaned === 'in_trip' || cleaned === 'underway') return 'in_progress'
  if (cleaned === 'enroute' || cleaned === 'en_route') return 'arriving'
  return cleaned
}

/** Standard human labels across rider and driver surfaces. */
export const RIDE_STATUS_LABELS = Object.freeze({
  searching: 'Looking for a driver',
  offered: 'Looking for a driver',
  requested: 'Ride requested',
  scheduled: 'Scheduled',
  accepted: 'Driver accepted',
  arriving: 'Driver arriving',
  arrived: 'Arrived at pickup',
  in_progress: 'Trip in progress',
  completed: 'Trip completed',
  canceled: 'Trip canceled',
  cancelled_wait: 'Canceled at pickup',
  canceled_midride: 'Canceled during the trip',
})

/** Rider-facing screen and card title headers. */
export const RIDER_STATUS_TITLES = Object.freeze({
  searching: 'Looking for a driver',
  offered: 'A driver is reviewing this ride',
  requested: 'Request sent',
  scheduled: 'Pickup is on the calendar',
  accepted: 'Your driver is on the way',
  arriving: 'Your driver is arriving',
  arrived: 'Your driver is at pickup',
  in_progress: 'You are on the way',
  completed: 'Trip complete',
  canceled: 'This ride was canceled',
  cancelled_wait: 'This ride was canceled',
  canceled_midride: 'Ride canceled mid-trip',
})

/** Driver-facing card headlines. */
export const DRIVER_STATUS_HEADLINES = Object.freeze({
  searching: 'New ride request',
  offered: 'New ride request',
  requested: 'A rider preferred you',
  scheduled: 'Scheduled ride',
  accepted: 'Head to pickup',
  arriving: 'Arriving at pickup',
  arrived: 'Waiting for the rider',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  canceled: 'Canceled',
  cancelled_wait: 'Canceled',
  canceled_midride: 'Canceled mid-trip',
})

/** Consistent badge tones corresponding to Clemson theme tokens. */
export const RIDE_STATUS_BADGE_TONES = Object.freeze({
  searching: 'orange',
  offered: 'orange',
  requested: 'orange',
  scheduled: 'purple',
  accepted: 'purple',
  arriving: 'orange',
  arrived: 'purple',
  in_progress: 'orange',
  completed: 'green',
  canceled: 'danger',
  cancelled_wait: 'danger',
  canceled_midride: 'danger',
})

/**
 * Returns a standardized human-readable label for any ride status.
 *
 * @param {string | null | undefined} status - Status code
 * @param {Object} [options]
 * @param {string} [options.fallback='Trip update'] - Fallback when status is missing or unrecognized
 * @returns {string} Standardized status label
 */
export function getRideStatusLabel(status, { fallback = 'Trip update' } = {}) {
  const norm = normalizeTripStatus(status)
  if (!norm) return fallback
  if (Object.prototype.hasOwnProperty.call(RIDE_STATUS_LABELS, norm)) {
    return RIDE_STATUS_LABELS[norm]
  }
  return status ? String(status) : fallback
}

/**
 * Returns a consistent badge tone ('orange' | 'purple' | 'green' | 'danger' | 'neutral')
 *
 * @param {string | null | undefined} status - Status code
 * @param {string} [fallback='neutral'] - Fallback tone
 * @returns {string} Badge tone identifier
 */
export function getRideStatusBadgeTone(status, fallback = 'neutral') {
  const norm = normalizeTripStatus(status)
  if (!norm) return fallback
  return RIDE_STATUS_BADGE_TONES[norm] || fallback
}

/**
 * Returns the standardized driver headline for a given status.
 *
 * @param {string | null | undefined} status - Status code
 * @returns {string} Driver headline
 */
export function getDriverStatusHeadline(status) {
  const norm = normalizeTripStatus(status)
  if (!norm) return 'Ride'
  if (Object.prototype.hasOwnProperty.call(DRIVER_STATUS_HEADLINES, norm)) {
    return DRIVER_STATUS_HEADLINES[norm]
  }
  return status ? String(status) : 'Ride'
}

/**
 * Returns the standardized rider title for a given status.
 *
 * @param {string | null | undefined} status - Status code
 * @param {Object} [options]
 * @param {boolean} [options.preferred=false] - Whether rider has a preferred driver requested
 * @returns {string} Rider tracking title
 */
export function getRiderStatusTitle(status, { preferred = false } = {}) {
  const norm = normalizeTripStatus(status)
  if (norm === 'requested' && preferred) {
    return 'Waiting on your driver'
  }
  if (!norm) return 'Ride requested'
  if (Object.prototype.hasOwnProperty.call(RIDER_STATUS_TITLES, norm)) {
    return RIDER_STATUS_TITLES[norm]
  }
  return status ? String(status) : 'Ride requested'
}
