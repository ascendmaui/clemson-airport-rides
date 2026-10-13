import { useEffect, useRef } from 'react'
import { useAuth } from '../lib/auth'
import { api } from '../lib/payments'
import { supabase } from '../lib/supabase'
import {
  RIDER_PICKUP_STREAM_STATUSES,
  shouldPublishRiderFix,
  shouldStreamRiderPickup,
} from '../../packages/rides-native/riderLivePickup.js'

/**
 * Web rider: same pickup stream as the phone app, only while a ride is booking.
 */
export function RiderPickupStream() {
  const { user } = useAuth()
  const last = useRef(null)

  useEffect(() => {
    if (!user?.id || !supabase || typeof navigator === 'undefined' || !navigator.geolocation) return undefined
    let alive = true
    let watchId = null
    let tripId = null
    const userId = user.id

    function publish(position) {
      if (!alive || !tripId) return
      const lat = position?.coords?.latitude
      const lng = position?.coords?.longitude
      const accuracy = position?.coords?.accuracy
      const heading = Number(position?.coords?.heading)
      const now = Date.now()
      const next = {
        lat,
        lng,
        accuracy,
        heading: Number.isFinite(heading) && heading >= 0 ? heading : null,
      }
      if (!shouldPublishRiderFix(last.current, next, now)) return
      last.current = { at: now, lat, lng }
      api('/api/rider-live', { tripId, ...next }).catch(() => {
        last.current = null
      })
    }

    async function ensureWatch() {
      const { data } = await supabase
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
        if (watchId != null) navigator.geolocation.clearWatch(watchId)
        watchId = null
        return
      }
      if (watchId != null) return
      watchId = navigator.geolocation.watchPosition(publish, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      })
    }

    void ensureWatch()
    const timer = setInterval(() => { void ensureWatch() }, 8000)
    return () => {
      alive = false
      clearInterval(timer)
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [user?.id])

  return null
}
