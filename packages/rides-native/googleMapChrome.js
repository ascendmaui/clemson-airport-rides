/** Dark Google map style. userInterfaceStyle is iOS-only, so Android needs this style array. */
export function googleMapStyle(scheme) {
  if (scheme !== 'dark') return null
  return [
    { elementType: 'geometry', stylers: [{ color: '#0e0b14' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#f5f6f8' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0e0b14' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2438' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16121f' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#120e18' }] },
  ]
}

export const ANDROID_MAP_UNAVAILABLE = 'This Android build has no Google Maps key, so campus tiles cannot load. Pickup and drop-off still work from the list. Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY and rebuild.'

export function usableGoogleMapsKey({ env = {}, manifestKey = '' } = {}) {
  const raw = String(env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_ANDROID_API_KEY || manifestKey || '').trim()
  if (!raw || /placeholder|your_google|your_android/i.test(raw)) return ''
  return raw
}

/** Apple Maps draws without a Google key. Android MapView does not. */
export function nativeMapTilesReady(platform, sources) {
  if (platform !== 'android') return true
  return Boolean(usableGoogleMapsKey(sources))
}
