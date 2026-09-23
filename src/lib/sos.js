import { supabase } from './supabase'
import { SOS_CHANNELS } from './sosAlert'

const RECENT_MS = 6 * 60 * 60 * 1000

export function readLivePosition(timeoutMs = 8000) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos?.coords?.latitude
        const lng = pos?.coords?.longitude
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          resolve(null)
          return
        }
        resolve({ lat, lng })
      },
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: timeoutMs },
    )
  })
}

export async function logSosEvent({ tripId, userId, lat, lng, channel }) {
  if (!SOS_CHANNELS.includes(channel)) {
    return { ok: false, error: 'Unknown SOS channel' }
  }
  if (!supabase) return { ok: false, error: 'Supabase is not configured' }
  if (!tripId || !userId) return { ok: false, error: 'Sign in on an active trip to save this SOS' }
  const row = {
    user_id: userId,
    trip_id: tripId,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    channel,
  }
  const { data, error } = await supabase
    .from('sos_events')
    .insert(row)
    .select('id, user_id, trip_id, lat, lng, channel, created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, event: data }
}

export async function fetchRecentSosEvents(tripId) {
  if (!supabase || !tripId) return []
  const since = new Date(Date.now() - RECENT_MS).toISOString()
  const { data, error } = await supabase
    .from('sos_events')
    .select('id, user_id, trip_id, lat, lng, channel, created_at')
    .eq('trip_id', tripId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return data || []
}

export function subscribeSosEvents(tripId, onInsert) {
  if (!supabase || !tripId) return () => {}
  const channel = supabase
    .channel(`sos-events-${tripId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'sos_events',
        filter: `trip_id=eq.${tripId}`,
      },
      (payload) => {
        if (payload?.new) onInsert?.(payload.new)
      },
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
