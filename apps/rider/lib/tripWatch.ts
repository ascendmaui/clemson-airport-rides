import { supabase } from '@/lib/supabase'

export type LiveTrip = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  pickup_lat: number | null
  dropoff_lat: number | null
  pickup_lng: number | null
  dropoff_lng: number | null
  driver_id: string | null
  driverName: string | null
  driverLat: number | null
  driverLng: number | null
}

const ACTIVE = new Set(['searching', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress'])

export function isLiveStatus(status: string | null) {
  return ACTIVE.has(String(status || ''))
}

export function subscribeLiveTrip(tripId: string, driverId: string | null, onChange: () => void) {
  const client = supabase
  if (!client || !tripId) return () => {}
  const channel = client.channel(`rider-live-${tripId}-${driverId || 'open'}`)
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
    () => onChange(),
  )
  if (driverId) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'driver_status', filter: `driver_id=eq.${driverId}` },
      () => onChange(),
    )
  }
  channel.subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

export async function loadLiveTrip(tripId: string): Promise<LiveTrip | null> {
  if (!supabase || !tripId) return null
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, driver_id')
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  let driverName: string | null = null
  let driverLat: number | null = null
  let driverLng: number | null = null
  if (data.driver_id) {
    const [profile, status] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', data.driver_id).maybeSingle(),
      supabase.from('driver_status').select('lat, lng').eq('driver_id', data.driver_id).maybeSingle(),
    ])
    driverName = profile.data?.full_name || null
    driverLat = status.data?.lat ?? null
    driverLng = status.data?.lng ?? null
  }
  return {
    id: data.id,
    status: data.status,
    pickup_label: data.pickup_label,
    dropoff_label: data.dropoff_label,
    pickup_lat: data.pickup_lat,
    pickup_lng: data.pickup_lng,
    dropoff_lat: data.dropoff_lat,
    dropoff_lng: data.dropoff_lng,
    driver_id: data.driver_id,
    driverName,
    driverLat,
    driverLng,
  }
}
