import { supabase } from './supabase'
import { downtownNow, typicalDemandPoints } from './downtownHeat'

export const HEAT_GRADIENT = [
  'rgba(82,45,128,0)',
  '#522D80',
  '#7A4CA8',
  '#C45A12',
  '#F56600',
]

export const HEAT_WINDOWS = [
  { id: 'now', label: 'Now' },
  { id: 'weekday_am', label: 'Weekday morning' },
  { id: 'friday_night', label: 'Friday night' },
  { id: 'last_7d', label: 'Last 7 days' },
]

export const MAP_TYPES = [
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
]

const MAP_TYPE_KEY = 'clemson-map-type'
const LOW_VOLUME_THRESHOLD = 8

export function loadMapType() {
  try {
    const v = sessionStorage.getItem(MAP_TYPE_KEY)
    if (v === 'satellite' || v === 'hybrid' || v === 'roadmap') return v
  } catch { /* ignore */ }
  return 'roadmap'
}

export function saveMapType(id) {
  try { sessionStorage.setItem(MAP_TYPE_KEY, id) } catch { /* ignore */ }
}

export function resolveDemandRange(mode, windowId = 'now') {
  const now = new Date()
  let from = new Date(now)
  const to = new Date(now)
  let hourStart = null
  let hourEnd = null
  if (mode === 'surge') {
    if (windowId === 'weekday_am') { from = new Date(now.getTime() - 7 * 864e5); hourStart = 7; hourEnd = 10 }
    else if (windowId === 'friday_night') { from = new Date(now.getTime() - 14 * 864e5); hourStart = 21; hourEnd = 23 }
    else if (windowId === 'last_7d') { from = new Date(now.getTime() - 7 * 864e5) }
    else { from = new Date(now.getTime() - 2 * 36e5) }
    return { from, to, hourStart, hourEnd }
  }
  if (windowId === 'weekday_am') { from = new Date(now.getTime() - 30 * 864e5); hourStart = 7; hourEnd = 10 }
  else if (windowId === 'friday_night') { from = new Date(now.getTime() - 30 * 864e5); hourStart = 21; hourEnd = 23 }
  else if (windowId === 'last_7d') { from = new Date(now.getTime() - 7 * 864e5) }
  else { from = new Date(now.getTime() - 14 * 864e5) }
  return { from, to, hourStart, hourEnd }
}

export async function fetchRideDemand({ mode = 'busy', windowId = 'now' } = {}) {
  const { from, to, hourStart, hourEnd } = resolveDemandRange(mode, windowId)
  let live = []
  let error = null
  if (supabase) {
    const { data, error: rpcErr } = await supabase.rpc('get_ride_demand', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_hour_start: hourStart,
      p_hour_end: hourEnd,
    })
    if (rpcErr) { error = rpcErr.message; console.warn('[rideDemand]', rpcErr.message) }
    else {
      live = (data || []).map((r) => ({
        lat: Number(r.lat), lng: Number(r.lng),
        weight: Math.max(0.2, Number(r.weight) || Number(r.request_count) || 1),
        requestCount: Number(r.request_count) || 0, source: 'live',
      })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    }
  } else { error = 'Supabase not configured' }

  const liveWeight = live.reduce((s, p) => s + p.weight, 0)
  const lowVolume = live.length < LOW_VOLUME_THRESHOLD || liveWeight < LOW_VOLUME_THRESHOLD
  let points = live.map((p) => (mode === 'surge' ? { ...p, weight: p.weight * 1.35 } : p))
  let blended = false
  if (mode === 'busy' || lowVolume) {
    const typicalScale = mode === 'surge' ? (lowVolume ? 0.45 : 0) : lowVolume ? 0.85 : 0.35
    if (typicalScale > 0) {
      const typical = typicalDemandPoints(new Date(), { includeCampus: true }).map((p) => ({
        ...p, weight: p.weight * typicalScale,
      }))
      points = [...points, ...typical]
      blended = true
    }
  }
  const snap = downtownNow()
  const caption = mode === 'surge'
    ? (blended ? 'Live + typical — position near hotter zones for better ride chances'
               : 'Live request density — hotter zones often mean more trip opportunities')
    : (blended ? `Live + typical — College Ave feels ${snap.label.toLowerCase()} for this hour`
               : 'Live ride-request density across campus')
  return {
    points, liveCount: live.length, blended, caption, mode, windowId, error,
    label: mode === 'surge' ? 'Surge Zones' : 'Busy Areas',
  }
}

export function toWeightedLocations(points) {
  if (typeof window === 'undefined' || !window.google?.maps) return []
  return (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => ({
    location: new window.google.maps.LatLng(p.lat, p.lng),
    weight: Math.max(0.1, Number(p.weight) || 1),
  }))
}

/** 0–1 surge intensity from demand points (friends fare optional multiplier). Not $. */
export function surgeIntensityFromPoints(points = []) {
  if (!points?.length) return 0
  const maxW = Math.max(...points.map((p) => Number(p.weight) || 0), 0)
  if (maxW <= 0) return 0
  return Math.max(0, Math.min(1, maxW / 8))
}

export async function fetchSurgeIntensity(windowId = 'now') {
  const result = await fetchRideDemand({ mode: 'surge', windowId })
  return {
    intensity: surgeIntensityFromPoints(result.points),
    blended: result.blended,
    liveCount: result.liveCount,
    label: result.label,
    error: result.error,
  }
}
