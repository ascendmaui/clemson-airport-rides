import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { RIDER_TRACK_STATUSES } from 'rides-native/liveTrip'
import { supabase } from '@/lib/supabase'
import { logCaught } from '@/lib/caught'
import { loadLiveTrip, subscribeLiveTrip, type LiveTrip } from '@/lib/tripWatch'

/**
 * The Rides tab live card reads the same trip load and subscription as the
 * live-ride screen. Focus, realtime, and an 8s poll all refresh it, so a
 * NativeTabs screen that stays mounted does not keep a stale status.
 */
export function useHomeLiveTrip(userId: string | null | undefined) {
  const [tripId, setTripId] = useState<string | null>(null)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [live, setLive] = useState<LiveTrip | null>(null)

  const refreshId = useCallback(async () => {
    if (!userId || !supabase) {
      setTripId(null)
      return
    }
    const { data } = await supabase
      .from('trips')
      .select('id')
      .eq('rider_id', userId)
      .in('status', [...RIDER_TRACK_STATUSES])
      .order('requested_at', { ascending: false })
      .limit(1)
    const row = Array.isArray(data) ? data[0] : data
    setTripId(row?.id ?? null)
  }, [userId])

  useFocusEffect(useCallback(() => {
    void refreshId()
    if (!supabase || !userId) return undefined
    const client = supabase
    const channel = client
      .channel(`rider-home-trips-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${userId}` },
        () => { void refreshId() },
      )
      .subscribe()
    const timer = setInterval(() => { void refreshId() }, 8000)
    return () => {
      clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [refreshId, userId]))

  useEffect(() => {
    if (!tripId) {
      setLive(null)
      setDriverId(null)
      return undefined
    }
    let alive = true
    const load = async () => {
      try {
        const next = await loadLiveTrip(tripId)
        if (!alive) return
        setLive(next)
        const nextDriver = next?.driver_id || null
        setDriverId((current) => (current === nextDriver ? current : nextDriver))
      } catch (err) {
        logCaught('home-live-trip', err)
      }
    }
    void load()
    const unsub = subscribeLiveTrip(tripId, driverId, () => { void load() })
    const timer = setInterval(() => { void load() }, 8000)
    return () => {
      alive = false
      unsub()
      clearInterval(timer)
    }
  }, [tripId, driverId])

  return live
}
