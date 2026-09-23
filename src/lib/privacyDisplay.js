/**
 * First name only. Chat headers and other matched-ride surfaces must not show a last name.
 * @param {unknown} fullName
 * @param {string} [fallback]
 */
export function displayFirstName(fullName, fallback = 'Rider') {
  if (typeof fullName !== 'string') return fallback
  const token = fullName.trim().split(/\s+/)[0] || ''
  const cleaned = token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.'’-]+$/u, '')
  return cleaned || fallback
}

const GRID_DEG = 0.01
const TITLES = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'miss', 'professor'])
const STREET = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|cir|circle|trl|trail|pl|place)\b/i
const SPOTS = [
  { test: /memorial stadium|death valley/i, label: 'Clemson · Memorial Stadium' },
  { test: /downtown clemson|college ave|college avenue/i, label: 'Clemson · downtown' },
  { test: /cooper library|tillman|schilletter|bowman|fike|hendrix|douthit|core campus|clemson university/i, label: 'Clemson · campus' },
  { test: /gsp|greenville[-\s]?spartanburg/i, label: 'Greenville · GSP Airport' },
  { test: /\bclt\b|charlotte douglas/i, label: 'Charlotte · CLT Airport' },
  { test: /\bseneca\b/i, label: 'Seneca area' },
]
const CITIES = [
  { test: /\bclemson\b/i, label: 'Clemson area' },
  { test: /\bgreenville\b/i, label: 'Greenville area' },
  { test: /\bcharlotte\b/i, label: 'Charlotte area' },
  { test: /\beasley\b/i, label: 'Easley area' },
  { test: /\banderson\b/i, label: 'Anderson area' },
  { test: /\bpendleton\b/i, label: 'Pendleton area' },
  { test: /\bcentral\b/i, label: 'Central area' },
  { test: /\bpiedmont\b/i, label: 'Piedmont area' },
]
const META_KEEP = ['kind', 'distance_m', 'duration_s', 'tip_cents', 'split_mode', 'friend_ride_id']

/** ~400m grid used by live offer previews. */
export const APPROX_GRID_METERS = 400
export const AREA_RADIUS_METERS = 450

function givenName(name) {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const local = raw.includes('@') ? raw.split('@')[0] : raw
  const tokens = local
    .split(/[\s._]+/)
    .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, ''))
    .filter(Boolean)
  return tokens.find((token) => !TITLES.has(token.toLowerCase().replace(/\./g, ''))) || ''
}

/** Neighborhood snap for earnings history. Not the ~400m offer-preview grid. */
export function approximateLatLng(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return null
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null
  const snap = (n) => Math.round(n / GRID_DEG) * GRID_DEG
  return {
    lat: Number(snap(la).toFixed(2)),
    lng: Number(snap(ln).toFixed(2)),
    precision: 'neighborhood',
  }
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6
}

/** Cell center for an active-offer area pin. */
export function approximateTripPin(lat, lng, gridMeters = APPROX_GRID_METERS) {
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  const meters = Number(gridMeters) > 50 ? Number(gridMeters) : APPROX_GRID_METERS
  const mLat = 111320
  const mLng = Math.max(111320 * Math.cos((la * Math.PI) / 180), 1)
  const dLat = meters / mLat
  const dLng = meters / mLng
  return {
    lat: round6((Math.floor(la / dLat) + 0.5) * dLat),
    lng: round6((Math.floor(ln / dLng) + 0.5) * dLng),
  }
}

export function coarseAreaLabel(label) {
  const raw = String(label ?? '').trim()
  if (!raw) return 'Trip completed'
  for (const spot of SPOTS) {
    if (spot.test.test(raw)) return spot.label
  }
  for (const city of CITIES) {
    if (city.test.test(raw)) return city.label
  }
  return 'Trip completed'
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

function scrubMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const next = {}
  for (const key of META_KEEP) {
    if (metadata[key] != null) next[key] = metadata[key]
  }
  if (Array.isArray(metadata.participants)) {
    next.participants = metadata.participants.map((p) => ({
      id: p?.id ?? null,
      fare_cents: p?.fare_cents ?? null,
      display_name: givenName(p?.display_name),
    }))
  }
  return next
}

export function maskTripLocationsForDriver(trip, options = {}) {
  if (!trip || typeof trip !== 'object') return trip
  const forceCompleted = options.completed === true
  const forceOpen = options.completed === false
  const completed = forceCompleted || (!forceOpen && (trip.status === 'completed' || Boolean(trip.completed_at)))
  if (!completed) return trip
  const pickup = approximateLatLng(trip.pickup_lat, trip.pickup_lng)
  const dropoff = approximateLatLng(trip.dropoff_lat, trip.dropoff_lng)
  return {
    ...trip,
    pickup_label: coarseAreaLabel(trip.pickup_label),
    dropoff_label: coarseAreaLabel(trip.dropoff_label),
    pickup_lat: pickup?.lat ?? null,
    pickup_lng: pickup?.lng ?? null,
    dropoff_lat: dropoff?.lat ?? null,
    dropoff_lng: dropoff?.lng ?? null,
    stops: [],
    rider_note: null,
    metadata: scrubMetadata(trip.metadata),
    location_masked: true,
    location_precision: 'neighborhood',
  }
}

export function maskCompletedTripForDriver(trip) {
  return maskTripLocationsForDriver(trip, { completed: true })
}

export function maskActiveAwareTrip(trip) {
  if (!trip || typeof trip !== 'object') return trip
  if (trip.status !== 'completed') return trip
  const pickup = approximateTripPin(trip.pickup_lat, trip.pickup_lng)
  const dropoff = approximateTripPin(trip.dropoff_lat, trip.dropoff_lng)
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
  if (viewerId && trip.driver_id === viewerId) return maskActiveAwareTrip(trip)
  return trip
}

export function maskedRouteSummary(pickup, dropoff) {
  const from = pickup || 'Trip completed'
  const to = dropoff || 'Trip completed'
  if (from === to) return from
  return `${from} → ${to}`
}
