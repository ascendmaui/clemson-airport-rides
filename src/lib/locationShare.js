import { supabase } from './supabase'
import { shareUrl } from './navigation'

function makeShareToken() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* fall through */
  }
  return `share_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export async function createLocationShare(tripId, riderId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!tripId || !riderId) throw new Error('trip and rider required')
  const { data: existing } = await supabase
    .from('location_shares')
    .select('id, token, active')
    .eq('trip_id', tripId)
    .eq('active', true)
    .maybeSingle()
  if (existing?.token) return { ...existing, url: shareUrl(existing.token) }

  const token = makeShareToken()
  const { data, error } = await supabase
    .from('location_shares')
    .insert({ trip_id: tripId, rider_id: riderId, active: true, token })
    .select('id, token, active')
    .single()
  if (error) throw new Error(error.message)
  if (!data?.token) throw new Error('Share created without token')
  return { ...data, url: shareUrl(data.token) }
}

export async function postLocationPoint({ shareId, lat, lng, accuracy }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('location_points').insert({
    share_id: shareId,
    lat,
    lng,
    accuracy_m: accuracy ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function getLiveShare(token) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('get_live_share', { p_token: token })
  if (error) throw new Error(error.message)
  return data
}

export async function revokeLocationShare(shareId) {
  if (!supabase || !shareId) return
  await supabase
    .from('location_shares')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq('id', shareId)
}

export function startSharingLocation({ shareId, tripId, onError }) {
  if (!navigator.geolocation) {
    onError?.(new Error('Geolocation not available'))
    return () => {}
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      postLocationPoint({
        shareId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }).catch((e) => onError?.(e))
    },
    (err) => onError?.(err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  )
  return () => navigator.geolocation.clearWatch(watchId)
}
