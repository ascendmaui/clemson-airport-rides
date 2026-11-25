/**
 * Campaign targeting for in-car tablet ads. Pure functions shared by the server feed, the
 * partner builder and tests.
 *
 * targeting = { radius_mi: 0|1|3|5, routes: ['all'] | subset of ROUTE_TYPE_IDS }
 * An ad is eligible for a ride when BOTH hold:
 *   - routes: 'all', or the ride is one of the chosen route types
 *   - radius: 0 (anywhere), or the pickup or drop-off is within radius_mi of the business
 *     (when the business has no map pin yet, radius is not enforced and the admin desk flags it)
 */
export const ROUTE_TYPES = [
  { id: 'all', label: 'All rides' },
  { id: 'campus', label: 'Campus loop' },
  { id: 'stadium', label: 'Stadium runs (game day)' },
  { id: 'late_night', label: 'Late night (9 PM to 3 AM)' },
  { id: 'airport', label: 'Airport runs' },
]
export const ROUTE_TYPE_IDS = ROUTE_TYPES.map((r) => r.id)
export const RADIUS_CHOICES = [0, 1, 3, 5]

export const PLACES = {
  campus: { lat: 34.6834, lng: -82.8374, radiusMi: 2.5 },
  stadium: { lat: 34.6788, lng: -82.8432, radiusMi: 1 },
  airports: [
    { code: 'GSP', lat: 34.8957, lng: -82.2189 },
    { code: 'CLT', lat: 35.214, lng: -80.9431 },
    { code: 'ATL', lat: 33.6407, lng: -84.4277 },
    { code: 'AND', lat: 34.4946, lng: -82.7099 },
  ],
  airportRadiusMi: 3,
}

export function milesBetween(a, b) {
  if (!a || !b) return Infinity
  const nums = [a.lat, a.lng, b.lat, b.lng].map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return Infinity
  const [lat1, lng1, lat2, lng2] = nums
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function normalizeTargeting(t = {}) {
  const radius = Number(t?.radius_mi ?? t?.radiusMi ?? 0)
  const radius_mi = RADIUS_CHOICES.includes(radius) ? radius : 0
  const raw = Array.isArray(t?.routes) ? t.routes : []
  let routes = [...new Set(raw.filter((r) => ROUTE_TYPE_IDS.includes(r)))]
  if (!routes.length || routes.includes('all')) routes = ['all']
  return { radius_mi, routes }
}

export function describeTargeting(t) {
  const n = normalizeTargeting(t)
  const routes = n.routes.map((id) => ROUTE_TYPES.find((r) => r.id === id)?.label || id).join(', ')
  return n.radius_mi ? `${routes} · within ${n.radius_mi} mi of your business` : `${routes} · anywhere in the service area`
}

function etHour(when) {
  const d = when instanceof Date ? when : new Date(when)
  if (!Number.isFinite(d.getTime())) return null
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(d))
}

const pickup = (trip) => ({ lat: trip?.pickup_lat, lng: trip?.pickup_lng })
const dropoff = (trip) => ({ lat: trip?.dropoff_lat, lng: trip?.dropoff_lng })

/** Which route types a ride is. */
export function tripRouteTypes(trip, { now = new Date(), gameDay = false } = {}) {
  const out = new Set(['all'])
  if (!trip) return out
  const p = pickup(trip)
  const d = dropoff(trip)
  if (milesBetween(p, PLACES.campus) <= PLACES.campus.radiusMi && milesBetween(d, PLACES.campus) <= PLACES.campus.radiusMi) out.add('campus')
  if (gameDay && (milesBetween(p, PLACES.stadium) <= PLACES.stadium.radiusMi || milesBetween(d, PLACES.stadium) <= PLACES.stadium.radiusMi)) out.add('stadium')
  const hour = etHour(trip.pickup_at || now)
  if (hour != null && (hour >= 21 || hour < 3)) out.add('late_night')
  const nearAirport = (pt) => PLACES.airports.some((a) => milesBetween(pt, a) <= PLACES.airportRadiusMi)
  if (trip.flight || nearAirport(p) || nearAirport(d)) out.add('airport')
  return out
}

/** Is this campaign eligible to play during this ride? No ride (idle loop) = eligible, never counted. */
export function tripMatchesTargeting(trip, targeting, { partner = null, now = new Date(), gameDay = false } = {}) {
  if (!trip) return true
  const t = normalizeTargeting(targeting)
  if (!t.routes.includes('all')) {
    const types = tripRouteTypes(trip, { now, gameDay })
    if (!t.routes.some((r) => types.has(r))) return false
  }
  if (t.radius_mi > 0) {
    const home = { lat: partner?.lat, lng: partner?.lng }
    if (!Number.isFinite(Number(home.lat)) || !Number.isFinite(Number(home.lng)) || home.lat == null || home.lng == null) return true
    if (milesBetween(pickup(trip), home) > t.radius_mi && milesBetween(dropoff(trip), home) > t.radius_mi) return false
  }
  return true
}
