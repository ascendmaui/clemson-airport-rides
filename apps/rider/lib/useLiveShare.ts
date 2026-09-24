import * as Location from 'expo-location'
import { useEffect, useState } from 'react'
import { postLocationPoint } from 'rides-native/safety.js'
import { supabase } from '@/lib/supabase'

export function useLiveShare(shareId: string | null) {
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)

  useEffect(() => {
    if (!shareId || !supabase) {
      setWatching(false)
      return undefined
    }
    let alive = true
    let sub: Location.LocationSubscription | null = null
    const client = supabase

    async function start() {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!alive) return
      if (!perm.granted) {
        setWatching(false)
        setError('Location permission is off. The trip link still opens, without live GPS.')
        return
      }
      setError(null)
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 },
        (pos) => {
          postLocationPoint(client, {
            shareId: shareId as string,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }).catch((err: unknown) => {
            if (!alive) return
            setError(err instanceof Error ? err.message : 'Could not post location')
          })
        },
      )
      if (!alive) {
        sub.remove()
        return
      }
      setWatching(true)
    }

    start().catch((err: unknown) => {
      if (!alive) return
      setWatching(false)
      setError(err instanceof Error ? err.message : 'GPS is unavailable on this device')
    })

    return () => {
      alive = false
      sub?.remove()
    }
  }, [shareId])

  return { error, watching }
}
