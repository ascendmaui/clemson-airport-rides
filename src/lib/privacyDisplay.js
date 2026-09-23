/**
 * Peer-facing privacy helpers.
 * Own account settings keep a legal name; everyone else sees a first name.
 * Completed trips shown to the driver use a coarse label and a ~400m area, not the pin they navigated to.
 */

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'professor'])
const STREET = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|cir|circle|trl|trail|pl|place)\b/i

/** ~400m grid. Cell center so the published point is an area, not the raw coordinate. */
export const APPROX_GRID_METERS = 400
export const AREA_RADIUS_METERS = 450

export function displayFirstName(fullName, fallback = '') {
  let raw = String(fullName || '').trim()
  if (!raw) return fallback
  if (raw.includes('@')) raw = raw.split('@')[0].replace(/[._-]+/g, ' ')
  let parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length > 1 && TITLES.has(parts[0].replace(/\./g, '').toLowerCase())) {
    parts = parts.slice(1)
  }
  const first = (parts[0] || '').replace(/[^A-Za-z'\-]/g, '')
  if (!first) return fallback
  return first.charAt(0).toUpperCase() + first.slice(1)
}

export function coarsePlaceLabel(label) {
  if (!label) return 'Nearby area'
  let s = String(label).trim()
  s = s.replace(/^\d+[a-zA-Z]?\s+/, '')
  s = s.replace(/\b(apt|apartment|suite|ste|unit|#)\s*[a-z0-9-]+/gi, '')
  s = s.replace(/\b\d{1,6}\b/g, '')
  s = s.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim()
  s = s.replace(/^,+|,+$/g, '').trim()
  if (!s) return 'Nearby area'
  const head = s.split(',')[0].trim()
  if (!head) return 'Nearby area'
  if (STREET.test(head)) return `${head} area`
  return head
}

export function approximateLatLng(lat, lng, gridMeters = APPROX_GRID_METERS) {
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  const meters = Number(gridMeters) > 50 ? Number(gridMeters) : APPROX_GRID_METERS
  const mLat = 111320
  const mLng = Math.max(111320 * Math.cos((la * Math.PI) / 180), 1)
  const dLat = meters / mLat
  const dLng = meters / mLng
  const latOut = (Math.floor(la / dLat) + 0.5) * dLat
  const lngOut = (Math.floor(ln / dLng) + 0.5) * dLng
  return { lat: round6(latOut), lng: round6(lngOut) }
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Mask precise pickup/drop-off after the trip is completed.
 * Active trips are returned unchanged so navigation still has the real pin.
 */
export function maskCompletedTripForDriver(trip) {
  if (!trip || typeof trip !== 'object') return trip
  if (trip.status !== 'completed') return trip
  const pickup = approximateLatLng(trip.pickup_lat, trip.pickup_lng)
  const dropoff = approximateLatLng(trip.dropoff_lat, trip.dropoff_lng)
  return {
    ...trip,
    pickup_label: coarsePlaceLabel(trip.pickup_label),
    dropoff_label: coarsePlaceLabel(trip.dropoff_label),
    pickup_lat: pickup ? pickup.lat : null,
    pickup_lng: pickup ? pickup.lng : null,
    dropoff_lat: dropoff ? dropoff.lat : null,
    dropoff_lng: dropoff ? dropoff.lng : null,
    _addressMasked: true,
    _areaRadiusM: AREA_RADIUS_METERS,
  }
}

export function driverFacingTrip(trip, viewerId) {
  if (!trip) return trip
  if (viewerId && trip.driver_id === viewerId) return maskCompletedTripForDriver(trip)
  return trip
}
