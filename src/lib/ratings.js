import { supabase } from './supabase'

export async function fetchProfile(userId) {
  if (!supabase || !userId) return null
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, bio, avatar_url, student_verified_at, rating_avg, rating_count, phone')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  let vehicle = null
  if (profile && (profile.role === 'driver' || profile.role === 'both')) {
    const { data: veh } = await supabase
      .from('vehicles')
      .select('make, model, color, plate, seats, is_tesla')
      .eq('driver_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    vehicle = veh
  }
  const { data: recent } = await supabase
    .from('ratings')
    .select('stars, comment, created_at')
    .eq('ratee_id', userId)
    .order('created_at', { ascending: false })
    .limit(8)
  return { ...profile, vehicle, recentRatings: recent || [] }
}

export async function updateMyProfile(userId, patch) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function submitRating({ tripId, raterId, rateeId, stars, comment }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('ratings').insert({
    trip_id: tripId,
    rater_id: raterId,
    ratee_id: rateeId,
    stars,
    comment: comment || null,
  })
  if (error) throw new Error(error.message)
}

export async function fetchTripForRating(tripId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, fare_cents')
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
