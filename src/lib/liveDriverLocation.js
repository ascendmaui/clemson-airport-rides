import { uniqueChannelTopic } from '../../packages/rides-native/realtimeChannel.js'
import { createTrackingRefresh, onTrackingResume, geolocationErrorMessage } from '../../packages/rides-native/tracking.js'
import { coordsFromRow, headingOrNull, liveFixFromReads, speedOrNull } from '../../packages/rides-native/liveFix.js'
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

function locationNumbers(coords) {
  const lat = Number(coords?.latitude ?? coords?.lat)
  const lng = Number(coords?.longitude ?? coords?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid location')
  return { lat, lng }
}

async function upsertTripDriverLocation(client, { tripId, driverId, coords, now }) {
  const { lat, lng } = locationNumbers(coords)
  const { error } = await client.from('trip_driver_locations').upsert({
    trip_id: tripId,
    driver_id: driverId,
    lat,
    lng,
    heading: headingOrNull(coords?.heading),
    speed: speedOrNull(coords?.speed),
    updated_at: now,
  })
  if (error) throw new Error(error.message)
}

export async function publishTripDriverLocation({ tripId, driverId, coords }) {
  if (!supabase || !tripId || !driverId) throw new Error('Live location is not configured')
  await upsertTripDriverLocation(supabase, { tripId, driverId, coords, now: new Date().toISOString() })
}

/** Presence plus the active-trip row. The presence write does not change online. */
export async function publishWebLiveFix(client, { tripId = null, driverId, coords }) {
  if (!client || !driverId) throw new Error('Live location is not configured')
  const { lat, lng } = locationNumbers(coords)
  const now = new Date().toISOString()
  const status = await client.from('driver_status').upsert({
    driver_id: driverId,
    lat,
    lng,
    heading: headingOrNull(coords?.heading),
    updated_at: now,
    location_updated_at: now,
  })
  if (status.error) throw new Error(status.error.message)
  if (!tripId) return { presence: true, trip: false }
  await upsertTripDriverLocation(client, { tripId, driverId, coords, now })
  return { presence: true, trip: true }
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
      await publishWebLiveFix(supabase, { tripId, driverId, coords: position.coords })
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

/** Trip telemetry first, then driver_status when that row is empty. Realtime plus an 8s poll. */
export function subscribeTripDriverLocation(tripId, onUpdate, onError, driverId = null) {
  if (!supabase || !tripId) return () => {}
  const presenceId = driverId || null
  let alive = true
  const reader = createTrackingRefresh({
    load: async () => {
      const tripRes = await supabase.from('trip_driver_locations')
        .select('trip_id, driver_id, lat, lng, heading, speed, updated_at').eq('trip_id', tripId).maybeSingle()
      let statusRes = { data: null, error: null }
      if (presenceId && !(tripRes.error == null && coordsFromRow(tripRes.data))) {
        statusRes = await supabase.from('driver_status')
          .select('lat, lng, heading, location_updated_at').eq('driver_id', presenceId).maybeSingle()
      }
      const picked = liveFixFromReads({
        tripRow: tripRes.error ? null : tripRes.data,
        tripError: tripRes.error,
        statusRow: statusRes.data,
        statusError: statusRes.error,
      })
      if (picked.error) throw picked.error
      if (!picked.fix) return null
      return {
        lat: picked.fix.lat,
        lng: picked.fix.lng,
        heading: picked.fix.heading,
        speed: picked.fix.speed,
        updated_at: picked.fix.updatedAt,
      }
    },
    onData: (row) => {
      if (!alive) return
      const fix = coordsFromRow(row)
      if (fix) onUpdate?.(fix)
    },
    onError: () => onError?.('Could not refresh driver location. Retrying automatically.'),
  })
  const refresh = () => void reader.refresh()
  refresh()
  const poll = setInterval(refresh, 8000)
  const offResume = onTrackingResume(() => void reader.refresh(true))
  let channel = supabase.channel(uniqueChannelTopic(`trip-driver-location-${tripId}`))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_driver_locations', filter: `trip_id=eq.${tripId}` }, refresh)
  if (presenceId) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'driver_status', filter: `driver_id=eq.${presenceId}` }, refresh)
  }
  channel.subscribe((status) => { if (status === 'SUBSCRIBED') void reader.refresh(true) })
  return () => { alive = false; reader.stop(); offResume(); clearInterval(poll); supabase.removeChannel(channel) }
}
