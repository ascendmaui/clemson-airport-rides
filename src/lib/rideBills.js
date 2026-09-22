import { supabase } from './supabase'

export async function fetchMyRideBills(userId, limit = 20) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('ride_bills')
    .select('*')
    .eq('participant_profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchBillsForTrip(tripId) {
  if (!supabase || !tripId) return []
  const { data, error } = await supabase
    .from('ride_bills')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}
