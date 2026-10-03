import { captureCurrentLocationPickup } from '../../packages/rides-native/currentLocation.js'

export function currentLocationDeniedCopy(reason) {
  if (reason === 'denied') {
    return 'Location was not allowed. Pick a campus or airport stop for pickup.'
  }
  return 'A fresh GPS fix was not available. Pick a campus or airport stop for pickup.'
}

function readFreshFix(geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation?.getCurrentPosition) {
      const missing = new Error('Geolocation is unavailable')
      missing.reason = 'unavailable'
      reject(missing)
      return
    }
    geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position?.coords?.latitude,
          lng: position?.coords?.longitude,
        })
      },
      (err) => {
        const denied = Number(err?.code) === 1
        const error = new Error(denied ? 'Location permission was not granted' : 'Location was not available')
        error.reason = denied ? 'denied' : 'unavailable'
        reject(error)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    )
  })
}

export function readBrowserCurrentLocation(deps = {}) {
  const ask = deps.ask || (() => {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
    return window.confirm('Allow current location for this pickup? GPS runs only after you allow it.')
  })
  const geolocation = deps.geolocation || (typeof navigator !== 'undefined' ? navigator.geolocation : null)
  return captureCurrentLocationPickup(ask, () => readFreshFix(geolocation))
}
