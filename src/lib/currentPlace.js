/** Number('') and Number('   ') are 0. A blank pin is missing, not the origin. */
export function finiteCoordinate(value) {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Shape a GPS fix into the pickup place the booking map and request share. */
export function placeFromCoordinates(lat, lng, label) {
  const latitude = finiteCoordinate(lat)
  const longitude = finiteCoordinate(lng)
  if (latitude == null || longitude == null) return null
  const name = String(label || '').trim()
  return { label: name || 'Current location', lat: latitude, lng: longitude }
}

export const LOCATION_DENIED_MESSAGE = 'Location permission is off. Type an address, or allow location in the browser and try again.'
export const LOCATION_UNAVAILABLE_MESSAGE = 'Could not read a location fix. Type an address instead.'
export const LOCATION_TIMEOUT_MESSAGE = 'Location timed out. Type an address, or try again.'
export const LOCATION_MISSING_MESSAGE = 'Location is not available on this device. Type an address instead.'

/** Map a GeolocationPositionError to copy a rider can act on. Never surface the raw browser string. */
export function geolocationFailureMessage(error) {
  const code = Number(error?.code)
  if (code === 1) return LOCATION_DENIED_MESSAGE
  if (code === 2) return LOCATION_UNAVAILABLE_MESSAGE
  if (code === 3) return LOCATION_TIMEOUT_MESSAGE
  const raw = typeof error?.message === 'string' ? error.message.trim() : ''
  if (!raw || /denied geolocation/i.test(raw)) return LOCATION_DENIED_MESSAGE
  return raw
}

function requestFix(geolocation, options) {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
        })
      },
      (err) => reject(err),
      options,
    )
  })
}

/**
 * One GPS read. A precise fix that times out or is unavailable falls back to a
 * coarse cached fix. Android Chrome often fails enableHighAccuracy indoors.
 * Permission denial does not retry.
 */
export function readBrowserPosition(geolocation = (typeof navigator !== 'undefined' ? navigator.geolocation : undefined)) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return Promise.reject(new Error(LOCATION_MISSING_MESSAGE))
  }
  const precise = { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
  const coarse = { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  return requestFix(geolocation, precise).catch(async (err) => {
    if (Number(err?.code) === 1) throw new Error(geolocationFailureMessage(err))
    try {
      return await requestFix(geolocation, coarse)
    } catch (coarseErr) {
      throw new Error(geolocationFailureMessage(Number(coarseErr?.code) ? coarseErr : err))
    }
  })
}

const GEOCODE_WAIT_MS = 1500

export function reverseGeocodeLabel(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  const fallback = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
    : 'Current location'
  const lookup = new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
        resolve(fallback)
        return
      }
      const geocoder = new window.google.maps.Geocoder()
      geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
        if (status === 'OK' && results?.[0]?.formatted_address) resolve(results[0].formatted_address)
        else resolve(fallback)
      })
    } catch {
      resolve(fallback)
    }
  })
  // An invalid or stalled Maps key never calls the geocoder callback. The
  // pickup still has to update from the GPS fix.
  const giveUp = new Promise((resolve) => {
    setTimeout(() => resolve(fallback), GEOCODE_WAIT_MS)
  })
  return Promise.race([lookup, giveUp])
}
