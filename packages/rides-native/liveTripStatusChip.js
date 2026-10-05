/**
 * Short labels for the rider live-trip map chip.
 * Display copy only. Does not read or publish driver location.
 *
 * Trip rows store `arriving` while the driver is on the way. The chip
 * vocabulary calls that phase `en_route`, and keeps it distinct from
 * `accepted` ("Driver accepted").
 */

export const LIVE_TRIP_CHIP_STATUSES = Object.freeze([
  'searching',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
])

export const LIVE_TRIP_STATUS_CHIP_LABELS = Object.freeze({
  searching: 'Looking for a driver',
  accepted: 'Driver accepted',
  en_route: 'En route',
  arrived: 'Arrived',
  in_progress: 'In trip',
  completed: 'Completed',
})

/** Stored trip statuses that share a chip with one of the keys above. */
const CHIP_STATUS_ALIASES = Object.freeze({
  offered: 'searching',
  arriving: 'en_route',
  enroute: 'en_route',
})

function chipStatusKey(status) {
  if (typeof status !== 'string') return ''
  return status.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Map a trip status to the map-chip label, or null when the chip should hide. */
export function liveTripStatusChipLabel(status) {
  const key = chipStatusKey(status)
  if (!key) return null
  const canonical = CHIP_STATUS_ALIASES[key] || key
  return LIVE_TRIP_STATUS_CHIP_LABELS[canonical] ?? null
}
