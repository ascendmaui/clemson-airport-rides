import { useEffect, useState } from 'react'
import { APPROACH_STATUSES } from '@/lib/approachAlert'
import { SHAREABLE_TRIP_STATUSES } from 'rides-native/safety.js'
import { supabase } from '@/lib/supabase'

export type RiderTrip = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  rider_id?: string | null
  driver_id?: string | null
}

const TRIP_COLUMNS = 'id, status, pickup_label, dropoff_label, rider_id, driver_id'

export function useTripById(tripId: string | null) {
  const [trip, setTrip] = useState<RiderTrip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(tripId))

  useEffect(() => {
    if (!tripId || !supabase) {
      setTrip(null)
      setLoading(false)
      setError(tripId && !supabase ? 'Supabase is not configured' : null)
      return undefined
    }
    let alive = true
    async function load() {
      const { data, error: queryError } = await supabase!
        .from('trips')
        .select(TRIP_COLUMNS)
        .eq('id', tripId)
        .maybeSingle()
      if (!alive) return
      if (queryError) setError(queryError.message)
      else {
        setError(null)
        setTrip((data as RiderTrip | null) || null)
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel(`rider-trip-${tripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
        () => { void load() },
      )
      .subscribe()
    const timer = setInterval(load, 15000)
    return () => {
      alive = false
      clearInterval(timer)
      void supabase!.removeChannel(channel)
    }
  }, [tripId])

  return { trip, error, loading }
}

export function useActiveRiderTrip(userId: string | null) {
  const [trip, setTrip] = useState<RiderTrip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(userId))

  useEffect(() => {
    if (!userId || !supabase) {
      setTrip(null)
      setLoading(false)
      setError(userId && !supabase ? 'Supabase is not configured' : null)
      return undefined
    }
    let alive = true
    async function load() {
      const { data, error: queryError } = await supabase!
        .from('trips')
        .select(TRIP_COLUMNS)
        .eq('rider_id', userId)
        .in('status', [...SHAREABLE_TRIP_STATUSES])
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive) return
      if (queryError) setError(queryError.message)
      else {
        setError(null)
        const row = Array.isArray(data) ? data[0] : data
        setTrip((row as RiderTrip | undefined) || null)
      }
      setLoading(false)
    }
    load()
    const timer = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [userId])

  return { trip, error, loading }
}

export type ApproachingTrip = {
  id: string
  status: string | null
  driver_id: string | null
}

export function useApproachingTrip(userId: string | null) {
  const [trip, setTrip] = useState<ApproachingTrip | null>(null)

  useEffect(() => {
    if (!userId || !supabase) {
      setTrip(null)
      return undefined
    }
    let alive = true
    async function load() {
      const { data, error: queryError } = await supabase!
        .from('trips')
        .select('id, status, driver_id')
        .eq('rider_id', userId)
        .in('status', [...APPROACH_STATUSES])
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive || queryError) return
      const row = Array.isArray(data) ? data[0] : data
      setTrip((row as ApproachingTrip | undefined) || null)
    }
    void load()
    const channel = supabase
      .channel(`rider-approach-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${userId}` },
        () => { void load() },
      )
      .subscribe()
    const timer = setInterval(() => {
      void load()
    }, 15000)
    return () => {
      alive = false
      clearInterval(timer)
      void supabase!.removeChannel(channel)
    }
  }, [userId])

  return trip
}
