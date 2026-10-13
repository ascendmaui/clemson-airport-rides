/**
 * Rider live-trip card chrome: map chip, map height, route prefix, secondary actions.
 * Display rules only. Does not read or publish driver location.
 */
import {
  LIVE_TRIP_CHIP_STATUSES,
  LIVE_TRIP_STATUS_CHIP_LABELS,
  liveTripStatusChipLabel,
} from './liveTripStatusChip.js'

export const LIVE_TRIP_MAP_HEIGHT = Object.freeze({
  tracking: 280,
  compact: 220,
})

const TONE_BY_LABEL = new Map(
  LIVE_TRIP_CHIP_STATUSES.map((status) => [LIVE_TRIP_STATUS_CHIP_LABELS[status], status]),
)

/** Map overlay for a trip status, or null when the chip should hide. */
export function liveTripMapChip(status) {
  const label = liveTripStatusChipLabel(status)
  if (!label) return null
  const tone = TONE_BY_LABEL.get(label) || 'searching'
  return {
    label,
    tone,
    spinning: tone === 'searching',
  }
}

/**
 * Taller map once a driver, a search preview, or a status chip needs room.
 * The compact height is the quiet map with nothing overlaid.
 */
export function liveTripMapHeight({ preview = false, driverOnMap = false, status } = {}) {
  if (preview || driverOnMap || liveTripStatusChipLabel(status)) return LIVE_TRIP_MAP_HEIGHT.tracking
  return LIVE_TRIP_MAP_HEIGHT.compact
}

/**
 * Name prefix on the route line. Empty once the driver card is showing,
 * and empty when the fallback name is blank, so the line does not start with " · ".
 */
export function liveTripRoutePrefix(driverName, driverOnCard) {
  if (driverOnCard) return ''
  const name = typeof driverName === 'string' ? driverName.trim() : ''
  if (!name) return ''
  return `${name} · `
}

/**
 * Secondary controls under the primary share / back actions.
 * Returns nothing when the trip cannot host them, and never includes a blank label.
 * Cancel is only offered while the trip is in progress — the state the server can price.
 * A trip already marked canceled_midride is not a cancel action.
 */
export function liveTripSecondaryActions(input = {}) {
  const status = typeof input.status === 'string' ? input.status : ''
  const tripId = input.tripId ? String(input.tripId) : ''
  if (!tripId || input.tripMissing) return []
  const actions = []
  if (input.showMessages) actions.push({ id: 'messages', label: 'Message' })
  if (status === 'completed') actions.push({ id: 'lost-found', label: 'Left something in the car?' })
  if (input.rateNudge) actions.push({ id: 'rate', label: 'Rate now' })
  if (status === 'in_progress') actions.push({ id: 'cancel', label: 'Cancel this ride' })
  return actions.filter((action) => typeof action.label === 'string' && action.label.trim())
}
