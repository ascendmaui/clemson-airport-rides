import { isOpenUnpaidAirportHold, shouldSurfaceHold } from 'rides-native/holdExpiryNotice.js'
import { supabase } from '@/lib/supabase'

export type RiderHoldTrip = {
  id: string
  status: string | null
  created_at: string | null
  deposit_cents: number | null
  fare_cents: number | null
  rider_note: string | null
  metadata: Record<string, unknown> | null
}

const HOLD_COLUMNS = 'id, status, created_at, deposit_cents, fare_cents, rider_note, metadata'

/** Trip fields the airport-hold countdown and the TTL-expired state read. */
export async function loadRiderHoldTrip(tripId: string): Promise<RiderHoldTrip | null> {
  if (!supabase || !tripId) return null
  const { data, error } = await supabase
    .from('trips')
    .select(HOLD_COLUMNS)
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return asHoldTrip(data)
}

function asHoldTrip(data: {
  id: string
  status?: string | null
  created_at?: string | null
  deposit_cents?: number | null
  fare_cents?: number | null
  rider_note?: string | null
  metadata?: unknown
}): RiderHoldTrip {
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : null
  return {
    id: data.id,
    status: data.status ?? null,
    created_at: data.created_at ?? null,
    deposit_cents: data.deposit_cents ?? null,
    fare_cents: data.fare_cents ?? null,
    rider_note: data.rider_note ?? null,
    metadata,
  }
}

/** Newest open unpaid airport hold, or a TTL cancel from the last 12 hours. */
export async function loadSurfaceHold(riderId: string): Promise<RiderHoldTrip | null> {
  if (!supabase || !riderId) return null
  const [openRes, canceledRes] = await Promise.all([
    supabase
      .from('trips')
      .select(HOLD_COLUMNS)
      .eq('rider_id', riderId)
      .in('status', ['searching', 'offered', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('trips')
      .select(HOLD_COLUMNS)
      .eq('rider_id', riderId)
      .eq('status', 'canceled')
      .order('created_at', { ascending: false })
      .limit(8),
  ])
  if (openRes.error) throw new Error(openRes.error.message)
  if (canceledRes.error) throw new Error(canceledRes.error.message)
  const open = (openRes.data || []).map((row) => asHoldTrip(row)).find((row) => isOpenUnpaidAirportHold(row))
  if (open) return open
  return (canceledRes.data || []).map((row) => asHoldTrip(row)).find((row) => shouldSurfaceHold(row)) || null
}
