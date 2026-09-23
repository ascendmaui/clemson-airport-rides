import * as Location from 'expo-location'
import { useEffect, useRef } from 'react'

export type DriverFix = { lat: number; lng: number; heading: number | null }

export function useDriverLocation(enabled: boolean, onFix: (fix: DriverFix) => void) {
  const onFixRef = useRef(onFix)
  onFixRef.current = onFix

  useEffect(() => {
    if (!enabled) return undefined
    let sub: Location.LocationSubscription | null = null
    let alive = true
    ;(async () => {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!alive || perm.status !== 'granted') return
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 5000 },
        (pos) => {
          onFixRef.current({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading,
          })
        },
      )
    })()
    return () => {
      alive = false
      sub?.remove()
    }
  }, [enabled])
}
