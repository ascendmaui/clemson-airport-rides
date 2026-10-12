/** Rider and driver app client for the opt-in campus community layer. */
import { EMPTY_COMMUNITY, communityRow, matchLines } from '../../shared/communityProfile.js'
export { COMMUNITY_FIELDS, COMMUNITY_PRIVACY_NOTE, EMPTY_COMMUNITY, parseCourses, matchLines } from '../../shared/communityProfile.js'

const COLUMNS = 'hometown, share_hometown, greek_org, share_greek_org, major, share_major, courses, share_courses, grad_year, share_grad_year'

export async function loadCommunityProfile(supabase, userId) {
  if (!supabase || !userId) return { ...EMPTY_COMMUNITY }
  const { data, error } = await supabase.from('community_profiles').select(COLUMNS).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message || 'Could not load your community profile')
  return data ? { ...EMPTY_COMMUNITY, ...data, courses: data.courses || [] } : { ...EMPTY_COMMUNITY }
}

export async function saveCommunityProfile(supabase, userId, form) {
  const row = communityRow(userId, form)
  const { error } = await supabase.from('community_profiles').upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(error.message || 'Could not save')
  return row
}

export async function removeCommunityProfile(supabase, userId) {
  const { error } = await supabase.from('community_profiles').delete().eq('user_id', userId)
  if (error) throw new Error(error.message || 'Could not remove')
}

/** Match lines for a trip (both sides opted in). Never throws. */
export async function loadCommunityMatches(supabase, tripId) {
  if (!supabase || !tripId) return []
  try {
    const { data, error } = await supabase.rpc('community_matches', { p_trip_id: tripId })
    return error ? [] : matchLines(data)
  } catch {
    return []
  }
}
