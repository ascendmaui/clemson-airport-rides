import { supabase } from './supabase'

/** Subscribe to a driver's live lat/lng from driver_status. Returns unsubscribe. */
export function subscribeDriverStatus(driverId, onUpdate) {
  if (!supabase || !driverId) return () => {}

  let alive = true
  const emit = (row) => {
    if (!alive || !row) return
    const lat = Number(row.lat)
    const lng = Number(row.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    onUpdate?.({
      lat,
      lng,
      heading: row.heading != null ? Number(row.heading) : null,
      online: Boolean(row.online),
      updatedAt: row.updated_at || null,
    })
  }

  async function pull() {
    const { data, error } = await supabase
      .from('driver_status')
      .select('driver_id, lat, lng, heading, online, updated_at')
      .eq('driver_id', driverId)
      .maybeSingle()
    if (error) {
      console.warn('[driverTrack]', error.message)
      return
    }
    emit(data)
  }

  pull()
  const poll = setInterval(pull, 4000)

  const channel = supabase
    .channel(`driver-status-${driverId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'driver_status',
        filter: `driver_id=eq.${driverId}`,
      },
      (payload) => emit(payload.new || payload.record),
    )
    .subscribe()

  return () => {
    alive = false
    clearInterval(poll)
    supabase.removeChannel(channel)
  }
}

/** Push the driver's own GPS into driver_status (best-effort). */
export async function publishDriverLocation(driverId, { lat, lng, heading = null, online = true }) {
  if (!supabase || !driverId) return
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const { error } = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    lat,
    lng,
    heading,
    online: Boolean(online),
    updated_at: new Date().toISOString(),
  })
  if (error) console.warn('[driverTrack] publish', error.message)
}
