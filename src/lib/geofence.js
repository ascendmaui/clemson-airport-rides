import { supabase } from './supabase'

/** Haversine distance in meters, or null when a coordinate is not finite. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const aLat = Number(lat1)
  const aLng = Number(lng1)
  const bLat = Number(lat2)
  const bLng = Number(lng2)
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null
  const R = 6371000
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dp = ((bLat - aLat) * Math.PI) / 180
  const dl = ((bLng - aLng) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  // asin() is NaN above 1; antipodal rounding can exceed 1 by an ulp.
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Check lat/lng against active rows in public.geofences.
 * Returns { inside, matches: [{ id, name, distanceM, radiusM }] }
 */
export async function checkGeofence(lat, lng) {
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
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
      const distanceM = distanceMeters(lat, lng, g?.center_lat, g?.center_lng)
      // null <= radius is true, so a non-finite center must not count as inside.
      if (distanceM == null) return null
      return {
        id: g.id,
        name: g.name,
        distanceM: Math.round(distanceM),
        radiusM: g.radius_m,
        inside: distanceM <= g.radius_m,
      }
    })
    .filter((g) => g?.inside)

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
