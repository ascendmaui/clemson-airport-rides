/**
 * Shared privacy display helpers for driver-facing history.
 *
 * Completed trips must not reveal a rider's exact stop. Active trips
 * (accepted / arriving / in progress) keep precise labels for navigation.
 *
 * Earnings UI should import these rather than rendering trip.pickup_label,
 * trip.dropoff_label, or raw coordinates.
 */

const GRID_DEG = 0.01

const TITLES = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'miss'])

/** Known coarse places. Output is always one of our phrases, never the raw label. */
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

/**
 * First name only. Drops last names, titles, and the domain of an email.
 * @param {unknown} name
 * @returns {string}
 */
export function displayFirstName(name) {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const local = raw.includes('@') ? raw.split('@')[0] : raw
  const tokens = local
    .split(/[\s._]+/)
    .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, ''))
    .filter(Boolean)
  const first = tokens.find((token) => !TITLES.has(token.toLowerCase().replace(/\./g, ''))) || ''
  return first
}

/**
 * Snap a coordinate to a ~1 km grid so many nearby stops share one pin.
 * Returns null when the input is not a finite coordinate.
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {{ lat: number, lng: number, precision: 'neighborhood' } | null}
 */
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

/**
 * Coarse area label. Never returns the original street string.
 * @param {unknown} label
 * @returns {string}
 */
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

function scrubMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  /** @type {Record<string, unknown>} */
  const next = {}
  for (const key of META_KEEP) {
    if (metadata[key] != null) next[key] = metadata[key]
  }
  if (Array.isArray(metadata.participants)) {
    next.participants = metadata.participants.map((p) => ({
      id: p?.id ?? null,
      fare_cents: p?.fare_cents ?? null,
      display_name: displayFirstName(p?.display_name),
    }))
  }
  return next
}

/**
 * Mask precise stops once a trip is completed.
 * Pass `{ completed: false }` for an in-progress trip that still needs the real address.
 * @param {Record<string, unknown> | null | undefined} trip
 * @param {{ completed?: boolean }} [options]
 */
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

/** Always mask, including rows that are completed history without a status field. */
export function maskCompletedTripForDriver(trip) {
  return maskTripLocationsForDriver(trip, { completed: true })
}

/**
 * One-line route that only uses already-masked labels.
 * @param {string} pickup
 * @param {string} dropoff
 */
export function maskedRouteSummary(pickup, dropoff) {
  const from = pickup || 'Trip completed'
  const to = dropoff || 'Trip completed'
  if (from === to) return from
  return `${from} → ${to}`
}
