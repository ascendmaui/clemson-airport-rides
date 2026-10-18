import * as Location from 'expo-location'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { createPresenceHeartbeat, type PresenceFix, type PresenceSnapshot } from 'rides-native/presenceHeartbeat'
import { setDriverOnline } from 'rides-native/drivers'
import { startLocationPublisher } from 'rides-native/tracking'
import { drainLocationWrites, publishDriverLocation, startOnlineBackgroundLocation, stopOnlineBackgroundLocation } from './backgroundLocation'
import { supabase } from './supabase'
import { quiet } from '@/lib/softFail'

let publisherError: string | null = null
const errorListeners = new Set<(error: string | null) => void>()
function setPublisherError(next: string | null) {
  publisherError = next
  for (const listener of errorListeners) listener(next)
}

/**
 * The app's only online heartbeat. Home screens configure it; they never own an interval.
 * A second Home mounted after a deep-link sign-in therefore cannot keep a driver online.
 */
export const driverPresence = createPresenceHeartbeat({
  startPublisher(onFix) {
    let alive = true
    let stop: (() => void) | undefined
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync()
        if (!alive) return
        if (permission.status !== 'granted') {
          setPublisherError('Location permission is off. Enable it in Settings, then retry location sharing.')
          return
        }
        stop = startLocationPublisher({
          locate: async (): Promise<PresenceFix> => {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
            return { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading }
          },
          publish: async (fix: PresenceFix) => { if (alive) await onFix(fix) },
          onFix: () => {},
          onError: setPublisherError,
        })
      } catch {
        if (alive) setPublisherError('Could not start location sharing. Retry after checking location settings.')
      }
    })()
    return () => { alive = false; stop?.(); setPublisherError(null) }
  },
  write: (driverId, fix, guards) => publishDriverLocation(supabase, driverId, fix, guards),
})

// Online (GO, or adopted from the server at launch) keeps an OS location service running so
// the pin keeps moving while the app is in the background. END/sign-out/driver change stop it
// synchronously into the location queue, ahead of drainLocationWrites and the offline write.
let onlineBackgroundFor: string | null = null
driverPresence.subscribe((snap) => {
  const want = snap.intent === 'online' && snap.driverId ? snap.driverId : null
  if (want === onlineBackgroundFor) return
  onlineBackgroundFor = want
  if (want) void startOnlineBackgroundLocation(want).catch(quiet('start online background location'))
  else void stopOnlineBackgroundLocation().catch(quiet('stop online background location'))
})

// Coming back to the foreground restarts the publisher (iOS may have paused timers).
AppState.addEventListener('change', (state) => {
  if (state === 'active' && driverPresence.snapshot().running) driverPresence.restart()
})

/** GO: the server write first, then the heartbeat. */
export async function goOnline(driverId: string, fix: { lat: number; lng: number; heading?: number | null } | null) {
  await setDriverOnline(supabase, driverId, true, fix)
  driverPresence.goOnline()
}

/** END: stop the heartbeat, let queued writes finish, then write offline. */
export async function goOffline(driverId: string) {
  driverPresence.goOffline()
  await drainLocationWrites().catch(quiet('drain location writes'))
  await setDriverOnline(supabase, driverId, false)
}

export function usePresence() {
  const [state, setState] = useState<PresenceSnapshot>(() => driverPresence.snapshot())
  const [error, setError] = useState<string | null>(publisherError)
  useEffect(() => driverPresence.subscribe(setState), [])
  useEffect(() => {
    errorListeners.add(setError)
    return () => { errorListeners.delete(setError) }
  }, [])
  return { ...state, error, retry: () => driverPresence.restart() }
}
