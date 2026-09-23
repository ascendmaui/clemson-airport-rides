import { supabase } from './supabase'
import { fetchFullProfile } from './profiles'

export { RATING_STANDING, standingFromRatings } from './standing.js'

/** Prefer fetchFullProfile — kept for existing callers */
export async function fetchProfile(userId, opts = {}) {
  return fetchFullProfile(userId, opts)
}

export async function updateMyProfile(userId, patch) {
  if (!supabase) throw new Error('Supabase is not configured')
  const allowed = {
    full_name: patch.full_name,
    bio: patch.bio,
    avatar_url: patch.avatar_url,
    favorite_spots: patch.favorite_spots,
    music_taste: patch.music_taste,
    ride_style: patch.ride_style,
    profile_privacy: patch.profile_privacy,
    phone: patch.phone,
    notification_prefs: patch.notification_prefs,
    billing_activated_at: patch.billing_activated_at,
  }
  const clean = Object.fromEntries(
    Object.entries(allowed).filter(([, v]) => v !== undefined),
  )
  const { error } = await supabase
    .from('profiles')
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function submitRating({ tripId, raterId, rateeId, stars, comment }) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!tripId || !raterId || !rateeId) throw new Error('Missing rating fields')
  if (raterId === rateeId) throw new Error('Cannot rate yourself')
  const s = Number(stars)
  if (!Number.isFinite(s) || s < 1 || s > 5) throw new Error('Stars must be 1–5')

  const trip = await fetchTripForRating(tripId)
  if (!trip) throw new Error('Trip not found')
  if (trip.status !== 'completed') {
    throw new Error('You can rate this trip once it is completed')
  }
  const expectedRatee = raterId === trip.rider_id ? trip.driver_id : trip.rider_id
  if (raterId !== trip.rider_id && raterId !== trip.driver_id) {
    throw new Error('Only the rider and driver can rate this trip')
  }
  if (!expectedRatee || expectedRatee !== rateeId) {
    throw new Error('Rate the other person on this trip')
  }

  const { data: existing } = await supabase
    .from('ratings')
    .select('id')
    .eq('trip_id', tripId)
    .eq('rater_id', raterId)
    .maybeSingle()
  if (existing?.id) throw new Error('You already rated this trip')

  const { error } = await supabase.from('ratings').insert({
    trip_id: tripId,
    rater_id: raterId,
    ratee_id: rateeId,
    stars: s,
    comment: comment?.trim() || null,
  })
  if (error) {
    if (/row-level security|permission/i.test(error.message || '')) {
      throw new Error('Could not save rating. The trip must be completed and you must be the rider or driver.')
    }
    throw new Error(error.message)
  }
}

export async function hasRatedTrip(tripId, raterId) {
  if (!supabase || !tripId || !raterId) return false
  const { data } = await supabase
    .from('ratings')
    .select('id')
    .eq('trip_id', tripId)
    .eq('rater_id', raterId)
    .maybeSingle()
  return Boolean(data?.id)
}

const TRIP_RATING_COLS = 'id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_cents, tip_cents, completed_at, safety_status, requested_at'
const TRIP_RATING_BASE = 'id, status, rider_id, driver_id, pickup_label, dropoff_label, fare_cents, completed_at'

export async function fetchTripForRating(tripId) {
  if (!supabase) return null
  const rich = await supabase.from('trips').select(TRIP_RATING_COLS).eq('id', tripId).maybeSingle()
  if (rich.error && /column|schema cache|tip_cents|safety_status/i.test(rich.error.message || '')) {
    const basic = await supabase.from('trips').select(TRIP_RATING_BASE).eq('id', tripId).maybeSingle()
    if (basic.error) throw new Error(basic.error.message)
    return basic.data
  }
  if (rich.error) throw new Error(rich.error.message)
  return rich.data
}

export async function saveSafetyCheck(tripId, status) {
  if (!supabase || !tripId) return { ok: false }
  const patch = {
    safety_status: status === 'help' ? 'help' : 'ok',
    safety_checked_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('trips').update(patch).eq('id', tripId)
  await supabase.from('trip_events').insert({
    trip_id: tripId,
    kind: status === 'help' ? 'safety_help' : 'safety_ok',
    payload: patch,
  })
  if (error && !/column|schema cache|safety_status/i.test(error.message || '')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Soft-remind: latest completed trip still needing this user's rating. */
export async function findPendingRatingTrip(userId) {
  if (!supabase || !userId) return null
  const { data: trips } = await supabase
    .from('trips')
    .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, completed_at')
    .eq('status', 'completed')
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
    .not('driver_id', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(5)
  if (!trips?.length) return null
  for (const t of trips) {
    const counterpart = t.rider_id === userId ? t.driver_id : t.rider_id
    if (!counterpart) continue
    const already = await hasRatedTrip(t.id, userId)
    if (!already) return t
  }
  return null
}
