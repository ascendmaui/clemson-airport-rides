import { supabase } from './supabase'

/** Haversine distance in meters */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Check lat/lng against active rows in public.geofences.
 * Returns { inside, matches: [{ id, name, distanceM, radiusM }] }
 */
export async function checkGeofence(lat, lng) {
  if (lat == null || lng == null) {
    return { inside: false, matches: [], error: 'missing coordinates' }
  }
  if (!supabase) {
    return { inside: false, matches: [], error: 'Supabase not configured' }
  }

  const { data, error } = await supabase
    .from('geofences')
    .select('id, name, center_lat, center_lng, radius_m, active')
    .eq('active', true)

  if (error) {
    return { inside: false, matches: [], error: error.message }
  }

  const matches = (data || [])
    .map((g) => {
      const distanceM = distanceMeters(lat, lng, g.center_lat, g.center_lng)
      return {
        id: g.id,
        name: g.name,
        distanceM: Math.round(distanceM),
        radiusM: g.radius_m,
        inside: distanceM <= g.radius_m,
      }
    })
    .filter((g) => g.inside)

  return { inside: matches.length > 0, matches, error: null }
}

export async function listGeofences() {
  if (!supabase) return []
  const { data } = await supabase
    .from('geofences')
    .select('id, name, center_lat, center_lng, radius_m, active')
    .eq('active', true)
  return data || []
}
