import {
  WOMEN_ONLY_ACCEPT_ERROR,
  sanitizeWomenOnlyPreference,
} from '../../shared/womenOnlyMatch.js'

const MISSING_COLUMN = /column|schema cache|gender_identity|women_only/i

export async function loadComfortPreference(supabase, userId) {
  const empty = { genderIdentity: 'unspecified', womenOnlyMatching: false, available: false, error: null }
  if (!supabase || !userId) return empty
  const { data, error } = await supabase
    .from('profiles')
    .select('gender_identity, women_only_matching')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    if (MISSING_COLUMN.test(error.message || '')) return empty
    return { ...empty, error: error.message || 'Could not load the comfort preference' }
  }
  const clean = sanitizeWomenOnlyPreference({
    genderIdentity: data?.gender_identity,
    womenOnly: data?.women_only_matching,
  })
  return {
    genderIdentity: clean.genderIdentity,
    womenOnlyMatching: clean.womenOnlyMatching,
    available: true,
    error: null,
  }
}

export async function saveComfortPreference(supabase, userId, input) {
  if (!supabase || !userId) throw new Error('Sign in to save this comfort preference')
  const clean = sanitizeWomenOnlyPreference(input)
  if (clean.rejected) {
    throw new Error('The women-only comfort preference is available when you identify as a woman.')
  }
  const { error } = await supabase
    .from('profiles')
    .update({
      gender_identity: clean.genderIdentity,
      women_only_matching: clean.womenOnlyMatching,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) {
    if (MISSING_COLUMN.test(error.message || '')) {
      throw new Error('This comfort preference needs a database update before it can be saved.')
    }
    throw new Error(error.message || 'Could not save the comfort preference')
  }
  return clean
}

/** Null means the database function is not available yet, so the desk does not hide rides. */
export async function visibleTripIdSet(supabase, tripIds) {
  if (!supabase || typeof supabase.rpc !== 'function' || !tripIds?.length) return null
  try {
    const { data, error } = await supabase.rpc('women_only_visible_trips', { trip_ids: tripIds })
    if (error || !Array.isArray(data)) return null
    return new Set(data)
  } catch {
    return null
  }
}

/** Null means unknown. False means the pair is blocked. */
export async function pairAllowedByRpc(supabase, riderId, driverId) {
  if (!supabase || typeof supabase.rpc !== 'function' || !riderId || !driverId) return null
  try {
    const { data, error } = await supabase.rpc('women_only_pair_allowed', {
      p_rider: riderId,
      p_driver: driverId,
    })
    if (error || typeof data !== 'boolean') return null
    return data
  } catch {
    return null
  }
}

export function filterVisibleTrips(rows, allowedIds) {
  if (!allowedIds) return rows || []
  return (rows || []).filter((row) => allowedIds.has(row.id))
}

export { WOMEN_ONLY_ACCEPT_ERROR }
