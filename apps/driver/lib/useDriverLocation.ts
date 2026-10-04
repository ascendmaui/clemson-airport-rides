import * as Location from 'expo-location'
import { AppState } from 'react-native'
import { useEffect, useRef, useState } from 'react'
import { startLocationPublisher } from 'rides-native/tracking'

export type DriverFix = { lat: number; lng: number; heading: number | null }

export function useDriverLocation(enabled: boolean, onFix: (fix: DriverFix) => void | Promise<void>) {
  const onFixRef = useRef(onFix)
  onFixRef.current = onFix
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = () => setAttempt((n) => n + 1)
  useEffect(() => {
    if (!enabled) { setError(null); return }
    let stop: (() => void) | undefined
    let alive = true
    async function start() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync()
        if (!alive) return
        if (permission.status !== 'granted') {
          setError('Location permission is off. Enable it in Settings, then retry location sharing.')
          return
        }
        stop = startLocationPublisher({
          locate: async (): Promise<DriverFix> => {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
            return { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading }
          },
          publish: async (fix) => { if (alive) await onFixRef.current(fix) },
          onFix: () => {},
          onError: setError,
        })
      } catch { if (alive) setError('Could not start location sharing. Retry after checking location settings.') }
    }
    void start()
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') retry() })
    return () => { alive = false; stop?.(); listener.remove() }
  }, [enabled, attempt])
  return { error, retry }
}
