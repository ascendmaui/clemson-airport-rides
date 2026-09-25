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
  requested_at: string | null
  created_at: string | null
  deposit_cents: number | null
  fare_cents: number | null
  rider_note: string | null
  stops: unknown[] | null
  metadata: Record<string, unknown> | null
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
    .select('id, status, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, driver_id, requested_at, created_at, deposit_cents, fare_cents, rider_note, stops, metadata')
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
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : null
  let stops = Array.isArray(data.stops) ? data.stops : null
  const friendRideId = typeof metadata?.friend_ride_id === 'string' ? metadata.friend_ride_id : ''
  if ((!stops || stops.length === 0) && friendRideId) {
    try {
      const { data: ride, error: rideError } = await supabase
        .from('friend_rides')
        .select('stops, kind, status')
        .eq('id', friendRideId)
        .maybeSingle()
      if (!rideError && ride && Array.isArray(ride.stops) && ride.stops.length) {
        stops = ride.stops
        if (metadata && ride.kind && metadata.kind == null) metadata.kind = ride.kind
      }
    } catch {
      /* Pickup and drop-off pins remain if the friend ride row is not readable. */
    }
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
    requested_at: data.requested_at || null,
    created_at: data.created_at ?? null,
    deposit_cents: data.deposit_cents ?? null,
    fare_cents: data.fare_cents ?? null,
    rider_note: data.rider_note ?? null,
    stops,
    metadata,
  }
}
