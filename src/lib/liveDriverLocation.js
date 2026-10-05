import { createTrackingRefresh, onTrackingResume, geolocationErrorMessage } from '../../packages/rides-native/tracking.js'
import { supabase } from './supabase.js'

export const LIVE_TRIP_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress']
const MIN_PUBLISH_MS = 4000
const MIN_MOVE_METERS = 15

export function isLiveTrip(status) {
  return LIVE_TRIP_STATUSES.includes(status)
}

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity
  const r = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(x))
}

export function shouldPublishLocation(previous, next, now = Date.now()) {
  return !previous || now - previous.publishedAt >= MIN_PUBLISH_MS || distanceMeters(previous, next) >= MIN_MOVE_METERS
}

export async function publishTripDriverLocation({ tripId, driverId, coords }) {
  if (!supabase || !tripId || !driverId) throw new Error('Live location is not configured')
  const lat = Number(coords?.latitude)
  const lng = Number(coords?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid location')
  const { error } = await supabase.from('trip_driver_locations').upsert({
    trip_id: tripId,
    driver_id: driverId,
    lat,
    lng,
    heading: Number.isFinite(Number(coords?.heading)) ? Number(coords.heading) : null,
    speed: Number.isFinite(Number(coords?.speed)) ? Number(coords.speed) : null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

/** GPS watcher for an active trip. Writes are throttled to 4s unless movement is 15m+. */
export function startTripLocationWatch({ tripId, driverId, onFix, onError }) {
  if (!navigator.geolocation) {
    onError?.('Location is unavailable in this browser.')
    return () => {}
  }
  let stopped = false
  let previous = null
  let publishing = false
  const watchId = navigator.geolocation.watchPosition(async (position) => {
    const next = { lat: Number(position.coords.latitude), lng: Number(position.coords.longitude) }
    if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng) || publishing || !shouldPublishLocation(previous, next)) return
    publishing = true
    try {
      await publishTripDriverLocation({ tripId, driverId, coords: position.coords })
      if (!stopped) {
        previous = { ...next, publishedAt: Date.now() }
        onFix?.(position)
        onError?.(null)
      }
    } catch (error) {
      if (!stopped) onError?.(error.message || 'Could not share live location. Retrying automatically.')
    } finally { publishing = false }
  }, (error) => onError?.(geolocationErrorMessage(error)), {
    enableHighAccuracy: true, maximumAge: 3000, timeout: 15000,
  })
  return () => { stopped = true; navigator.geolocation.clearWatch(watchId) }
}

/** Reads only the assigned driver's active-trip location; realtime with an 8s fallback. */
export function subscribeTripDriverLocation(tripId, onUpdate, onError) {
  if (!supabase || !tripId) return () => {}
  let alive = true
  const reader = createTrackingRefresh({
    load: async () => {
      const { data, error } = await supabase.from('trip_driver_locations')
        .select('trip_id, driver_id, lat, lng, heading, speed, updated_at').eq('trip_id', tripId).maybeSingle()
      if (error) throw error
      return data
    },
    onData: (row) => {
      if (!alive || !row) return
      const lat = Number(row.lat); const lng = Number(row.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) onUpdate?.({ lat, lng, heading: Number(row.heading), speed: Number(row.speed), updatedAt: row.updated_at })
    },
    onError: () => onError?.('Could not refresh driver location. Retrying automatically.'),
  })
  const refresh = () => void reader.refresh()
  refresh()
  const poll = setInterval(refresh, 8000)
  const offResume = onTrackingResume(() => void reader.refresh(true))
  const channel = supabase.channel(`trip-driver-location-${tripId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_driver_locations', filter: `trip_id=eq.${tripId}` }, refresh)
    .subscribe((status) => { if (status === 'SUBSCRIBED') void reader.refresh(true) })
  return () => { alive = false; reader.stop(); offResume(); clearInterval(poll); supabase.removeChannel(channel) }
}
