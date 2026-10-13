/** Active-trip GPS statuses shared by web and native publishers and riders. */
export const LIVE_LOCATION_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress']

export function isLiveLocationStatus(status) {
  return LIVE_LOCATION_STATUSES.includes(String(status || ''))
}

export function headingOrNull(value) {
  const heading = Number(value)
  if (!Number.isFinite(heading) || heading < 0 || heading > 360) return null
  return heading
}

export function speedOrNull(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed < 0) return null
  return speed
}

export function coordsFromRow(row) {
  if (!row) return null
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    lat,
    lng,
    heading: headingOrNull(row.heading),
    speed: speedOrNull(row.speed),
    updatedAt: row.updated_at || row.location_updated_at || null,
  }
}

/**
 * Trip telemetry wins. Presence is only the backup when that row is missing
 * or has no coordinates, including when the trip table is not deployed yet.
 */
export function liveFixFromReads({ tripRow = null, tripError = null, statusRow = null, statusError = null } = {}) {
  const tripFix = coordsFromRow(tripRow)
  if (tripFix) return { fix: tripFix, error: null }
  const statusFix = coordsFromRow(statusRow)
  if (statusFix) return { fix: statusFix, error: null }
  const meaningfulTripError = tripError && !missingTripLocationTable(tripError) ? tripError : null
  return { fix: null, error: meaningfulTripError || statusError || null }
}

export function missingTripLocationTable(error) {
  const message = String(error?.message || error || '')
  return /trip_driver_locations|schema cache|does not exist|could not find the table/i.test(message)
}
