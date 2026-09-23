import { supabase } from './supabase'
import { displayFirstName } from './privacyDisplay.js'

export const QUEUE_CAP = 2
export const NEAR_DROPOFF_MINUTES = 5

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchOfferPreview(tripId) {
  const empty = { riderFirstName: 'Rider', ratingAvg: null, ratingCount: 0, standing: 'good' }
  if (!tripId) return empty
  try {
    const res = await fetch('/api/driver?action=offer-preview', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ tripId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return empty
    return {
      riderFirstName: displayFirstName(data.riderFirstName, 'Rider'),
      ratingAvg: data.ratingAvg != null ? Number(data.ratingAvg) : null,
      ratingCount: Number(data.ratingCount) || 0,
      standing: data.standing || 'good',
    }
  } catch {
    return empty
  }
}

export async function listQueue(driverId) {
  if (!supabase || !driverId) return []
  const { data, error } = await supabase
    .from('driver_ride_queue')
    .select('id, trip_id, queue_position, status, created_at')
    .eq('driver_id', driverId)
    .eq('status', 'queued')
    .order('queue_position', { ascending: true })
  if (error) {
    console.error('[queue]', error.message)
    return []
  }
  return data || []
}

export async function listPasses(driverId) {
  if (!supabase || !driverId) return []
  const { data, error } = await supabase
    .from('driver_offer_passes')
    .select('trip_id')
    .eq('driver_id', driverId)
  if (error) return []
  return (data || []).map((r) => r.trip_id)
}

export async function passOffer(driverId, tripId) {
  if (!supabase || !driverId || !tripId) return
  const { error } = await supabase
    .from('driver_offer_passes')
    .upsert({ driver_id: driverId, trip_id: tripId })
  if (error) console.error('[pass]', error.message)
}

export async function claimTrip(driverId, tripId) {
  if (!supabase || !driverId || !tripId) throw new Error('Missing trip')
  const acceptedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('trips')
    .update({
      status: 'accepted',
      driver_id: driverId,
      accepted_at: acceptedAt,
    })
    .eq('id', tripId)
    .in('status', ['searching', 'offered'])
    .is('driver_id', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('That ride was just taken')
  await supabase.from('trip_events').insert({
    trip_id: tripId,
    kind: 'accepted',
    payload: { driver_id: driverId, accepted_at: acceptedAt },
  })
  return { acceptedAt }
}

async function openQueue(driverId) {
  const { data, error } = await supabase
    .from('driver_ride_queue')
    .select('id, queue_position')
    .eq('driver_id', driverId)
    .eq('status', 'queued')
    .order('queue_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function enqueueClaimedTrip(driverId, tripId, { front = false } = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  const rows = await openQueue(driverId)
  if (rows.length >= QUEUE_CAP) throw new Error('Queue is full (2 rides ahead)')
  let position = 1
  if (front) {
    const at1 = rows.find((r) => r.queue_position === 1)
    if (at1) {
      if (rows.some((r) => r.queue_position === 2)) throw new Error('Queue is full (2 rides ahead)')
      const { error } = await supabase
        .from('driver_ride_queue')
        .update({ queue_position: 2 })
        .eq('id', at1.id)
      if (error) throw new Error(error.message)
    }
    position = 1
  } else {
    const used = new Set(rows.map((r) => r.queue_position))
    position = used.has(1) ? 2 : 1
  }
  const { error } = await supabase.from('driver_ride_queue').insert({
    driver_id: driverId,
    trip_id: tripId,
    queue_position: position,
    status: 'queued',
  })
  if (error) throw new Error(error.message)
  return { position }
}

export async function finishQueuedTrip(driverId, tripId) {
  if (!supabase || !driverId || !tripId) return
  await supabase
    .from('driver_ride_queue')
    .update({ status: 'promoted' })
    .eq('driver_id', driverId)
    .eq('trip_id', tripId)
    .eq('status', 'queued')
}

export async function takeNextQueued(driverId) {
  if (!supabase || !driverId) return null
  const { data, error } = await supabase
    .from('driver_ride_queue')
    .select('id, trip_id, queue_position')
    .eq('driver_id', driverId)
    .eq('status', 'queued')
    .order('queue_position', { ascending: true })
    .limit(1)
  if (error || !data?.length) return null
  const row = data[0]
  await supabase.from('driver_ride_queue').update({ status: 'promoted' }).eq('id', row.id)
  const { data: trip } = await supabase.from('trips').select('*').eq('id', row.trip_id).maybeSingle()
  return trip || null
}
