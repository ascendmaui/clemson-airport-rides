import * as Location from 'expo-location'
import { useEffect, useRef } from 'react'
import { authedJson } from 'rides-native/apiClient'
import {
  RIDER_PICKUP_STREAM_STATUSES,
  shouldPublishRiderFix,
  shouldStreamRiderPickup,
} from 'rides-native/riderLivePickup'
import { supabase } from '@/lib/supabase'

/**
 * While a ride is searching, offered, or on the way to pickup, publish a
 * high-accuracy fix for the matched or offered driver. Stops once the trip
 * is underway to the drop-off.
 */
export function useRiderPickupStream(userId: string | null) {
  const last = useRef<{ at: number; lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!userId || !supabase) return undefined
    let alive = true
    let sub: Location.LocationSubscription | null = null
    let tripId: string | null = null
    const client = supabase

    async function publish(pos: Location.LocationObject) {
      if (!alive || !tripId) return
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      const accuracy = pos.coords.accuracy
      const heading = Number(pos.coords.heading)
      const now = Date.now()
      const next = {
        lat,
        lng,
        accuracy,
        heading: Number.isFinite(heading) && heading >= 0 ? heading : null,
      }
      if (!shouldPublishRiderFix(last.current, next, now)) return
      last.current = { at: now, lat, lng }
      try {
        await authedJson(client, '/api/rider-live', {
          method: 'POST',
          body: { tripId, ...next },
        })
      } catch {
        last.current = null
      }
    }

    async function ensureWatch() {
      const { data } = await client
        .from('trips')
        .select('id, status')
        .eq('rider_id', userId)
        .in('status', [...RIDER_PICKUP_STREAM_STATUSES])
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive) return
      const row = Array.isArray(data) ? data[0] : data
      const nextId = row && shouldStreamRiderPickup(row.status) ? String(row.id) : null
      if (nextId !== tripId) {
        tripId = nextId
        last.current = null
      }
      if (!tripId) {
        sub?.remove()
        sub = null
        return
      }
      if (sub) return
      const current = await Location.getForegroundPermissionsAsync()
      const granted = current.granted || (await Location.requestForegroundPermissionsAsync()).granted
      if (!alive || !granted || !tripId) return
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (pos) => { void publish(pos) },
      )
      if (!alive) {
        sub.remove()
        sub = null
      }
    }

    void ensureWatch()
    const timer = setInterval(() => { void ensureWatch() }, 8000)
    return () => {
      alive = false
      clearInterval(timer)
      sub?.remove()
    }
  }, [userId])
}
