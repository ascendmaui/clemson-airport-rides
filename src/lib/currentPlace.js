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

export function readBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not available on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
        })
      },
      (err) => {
        const message = err?.message || 'Could not get current location. Check permissions.'
        reject(err instanceof Error ? err : new Error(message))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    )
  })
}

export function reverseGeocodeLabel(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  const fallback = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
    : 'Current location'
  return new Promise((resolve) => {
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
}
