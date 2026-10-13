/**
 * Pickup beacon: a short code shown full screen when a matched driver is
 * beside the rider or the pickup pin. The code is generated at match time.
 * Distance uses haversine meters with an outer band so GPS wobble cannot
 * flicker the screen on and off.
 */

export const PICKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PICKUP_CODE_LENGTH = 3

/** 50 ft. The screen opens at this distance. */
export const PICKUP_BEACON_ENTER_METERS = 15.24

/** 75 ft. Once open, the screen stays up until the driver is past this. */
export const PICKUP_BEACON_EXIT_METERS = 22.86

export const PICKUP_BEACON_STATUSES = Object.freeze(['accepted', 'arriving', 'arrived'])

export const PICKUP_BEACON_ORANGE = '#F56600'
export const PICKUP_BEACON_RIDER_PROMPT = 'Hold up your phone for your driver to see'
export const PICKUP_BEACON_DRIVER_PROMPT = "Match this code to the rider's phone"

export const PICKUP_BEACON_DISMISS_KEY = 'pickup.beacon.dismissed'
export const PICKUP_BEACON_DISMISS_LIMIT = 40

export const PICKUP_BEACON_PULSE_MS = 1800

const PULSE_REST = Object.freeze({ opacity: 0.22, scale: 1 })
const PULSE_PEAK = Object.freeze({ opacity: 0.46, scale: 1.035 })

const CODE_PATTERN = new RegExp(`^[${PICKUP_CODE_ALPHABET}]{2,3}$`)

export function generatePickupCode(random = Math.random) {
  let code = ''
  for (let i = 0; i < PICKUP_CODE_LENGTH; i += 1) {
    const sample = Number(random())
    const unit = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0
    const index = Math.floor(unit * PICKUP_CODE_ALPHABET.length)
    code += PICKUP_CODE_ALPHABET[index]
  }
  return code
}

export function isPickupCode(value) {
  return typeof value === 'string' && CODE_PATTERN.test(value)
}

export function pickupBeaconPrompt(role) {
  if (role === 'rider') return PICKUP_BEACON_RIDER_PROMPT
  if (role === 'driver') return PICKUP_BEACON_DRIVER_PROMPT
  throw new Error(`Unknown pickup beacon role ${String(role)}`)
}

/**
 * Slow brightness breath for the rider plate.
 * Opacities stay strictly between 0 and 1 so the wash never fades out.
 * Reduce motion holds the rest frame.
 */
export function pickupBeaconPulse(reduceMotion) {
  return {
    enabled: reduceMotion !== true,
    durationMs: PICKUP_BEACON_PULSE_MS,
    easing: 'inOutSin',
    uiThread: true,
    rest: PULSE_REST,
    peak: PULSE_PEAK,
  }
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const coords = [lat1, lng1, lat2, lng2].map((value) => Number(value))
  if (coords.some((value) => !Number.isFinite(value))) return null
  const [aLat, aLng, bLat, bLng] = coords
  if (Math.abs(aLat) > 90 || Math.abs(bLat) > 90) return null
  if (Math.abs(aLng) > 180 || Math.abs(bLng) > 180) return null
  const earth = 6371000
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)))
}

function pointOf(point) {
  if (!point) return null
  const lat = Number(point.lat ?? point.latitude)
  const lng = Number(point.lng ?? point.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Closest of the rider and the pickup pin. Null when the driver fix is missing. */
export function nearestBeaconMeters(driver, targets) {
  const origin = pointOf(driver)
  if (!origin) return null
  let nearest = null
  for (const target of targets || []) {
    const place = pointOf(target)
    if (!place) continue
    const meters = haversineMeters(origin.lat, origin.lng, place.lat, place.lng)
    if (meters == null) continue
    if (nearest == null || meters < nearest) nearest = meters
  }
  return nearest
}

function tripRiderId(trip) {
  return trip?.rider_id ?? trip?.riderId ?? null
}

function tripDriverId(trip) {
  return trip?.driver_id ?? trip?.driverId ?? null
}

/** True only for the rider on a matched trip or the driver assigned to it. */
export function viewerMayReadPickupCode(trip, userId) {
  if (!trip || userId == null || userId === '') return false
  const driverId = tripDriverId(trip)
  if (!driverId) return false
  return tripRiderId(trip) === userId || driverId === userId
}

/** The code string for an allowed viewer, or null. Never leaks a bad code. */
export function pickupCodeForViewer(trip, userId, code) {
  if (!viewerMayReadPickupCode(trip, userId)) return null
  return isPickupCode(code) ? code : null
}

export function pickupBeaconShouldShow(input) {
  const status = String(input?.status || '')
  if (!PICKUP_BEACON_STATUSES.includes(status)) return false
  if (input?.dismissed === true) return false
  if (!isPickupCode(input?.code)) return false
  const meters = nearestBeaconMeters(input?.driver, [input?.rider, input?.pickup])
  if (meters == null) return false
  const limit = input?.wasOpen === true ? PICKUP_BEACON_EXIT_METERS : PICKUP_BEACON_ENTER_METERS
  return meters <= limit
}

export function parseDismissedTrips(raw) {
  if (raw == null || raw === '') return {}
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out = {}
  for (const [id, on] of Object.entries(parsed)) {
    if (on === true && String(id).trim()) out[String(id)] = true
  }
  return out
}

export function isTripDismissed(map, tripId) {
  const id = String(tripId || '').trim()
  if (!id || !map) return false
  return map[id] === true
}

export function rememberDismissal(map, tripId) {
  const id = String(tripId || '').trim()
  const base = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {}
  if (!id) return base
  base[id] = true
  const ids = Object.keys(base).filter((key) => base[key] === true)
  if (ids.length <= PICKUP_BEACON_DISMISS_LIMIT) return base
  const kept = {}
  for (const key of ids.slice(ids.length - PICKUP_BEACON_DISMISS_LIMIT)) kept[key] = true
  return kept
}

export function serializeDismissedTrips(map) {
  return JSON.stringify(parseDismissedTrips(map))
}

export async function loadDismissedPickupBeacons(store) {
  if (!store || typeof store.getItem !== 'function') return {}
  const raw = await store.getItem(PICKUP_BEACON_DISMISS_KEY)
  return parseDismissedTrips(raw)
}

export async function persistDismissedPickupBeacon(tripId, store) {
  const current = await loadDismissedPickupBeacons(store)
  const next = rememberDismissal(current, tripId)
  if (store && typeof store.setItem === 'function') {
    await store.setItem(PICKUP_BEACON_DISMISS_KEY, serializeDismissedTrips(next))
  }
  return next
}

export function pickupBeaconLiveRide(role, tripId) {
  if (role === 'rider') return { pathname: '/requested', params: { trip: tripId } }
  if (role === 'driver') return { pathname: '/trip', params: { id: tripId } }
  throw new Error(`Unknown pickup beacon role ${String(role)}`)
}

export function alreadyOnLiveRide(role, pathname) {
  const path = String(pathname || '')
  if (role === 'rider') return path === '/requested' || path.startsWith('/requested/')
  if (role === 'driver') return path === '/trip' || path.startsWith('/trip/')
  return false
}
