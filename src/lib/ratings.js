import { supabase } from './supabase'
import { fetchFullProfile } from './profiles'
import { ratingBlockReason } from '../../packages/rides-native/partyProfile.js'

export { ratingBlockReason }

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

function explainRatingError(message) {
  if (/row-level security|42501/i.test(message || '')) {
    return 'Rating was not saved. You can rate only after the trip is completed, and only the other person on that trip.'
  }
  return message || 'Could not submit rating'
}

export async function submitRating({ tripId, raterId, rateeId, stars, comment }) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!tripId || !raterId || !rateeId) throw new Error('Missing rating fields')
  if (raterId === rateeId) throw new Error('Cannot rate yourself')
  const s = Number(stars)
  if (!Number.isFinite(s) || s < 1 || s > 5) throw new Error('Stars must be 1–5')

  const trip = await fetchTripForRating(tripId)
  const blocked = ratingBlockReason(trip, raterId)
  if (blocked) throw new Error(blocked)
  const expectedRatee = raterId === trip.rider_id ? trip.driver_id : trip.rider_id
  if (rateeId !== expectedRatee) throw new Error('You can only rate the other person on this trip.')

  const { data: existing, error: lookupError } = await supabase
    .from('ratings')
    .select('id')
    .eq('trip_id', tripId)
    .eq('rater_id', raterId)
    .maybeSingle()
  if (lookupError) throw new Error(explainRatingError(lookupError.message))
  if (existing?.id) throw new Error('You already rated this trip')

  const { data, error } = await supabase
    .from('ratings')
    .insert({
      trip_id: tripId,
      rater_id: raterId,
      ratee_id: rateeId,
      stars: s,
      comment: comment?.trim() || null,
    })
    .select('id, stars')
    .single()
  if (error) throw new Error(explainRatingError(error.message))
  if (!data?.id) throw new Error('Rating was not saved')
  return data
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

export async function fetchTripForRating(tripId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, fare_cents, deposit_cents, tip_cents, completed_at, canceled_at')
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
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
    if (!counterpart || counterpart === userId) continue
    const already = await hasRatedTrip(t.id, userId)
    if (!already) return t
  }
  return null
}
