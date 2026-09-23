export type OnlineDriver = {
  id: string
  name: string
  ratingAvg: number | null
  ratingCount: number
  standing: string
  online: boolean
  lat: number | null
  lng: number | null
  vehicleLabel: string
  plate: string | null
  isTesla: boolean
  tier: string
}

export function fetchOnlineDrivers(supabase: unknown): Promise<{ drivers: OnlineDriver[]; error: string | null }>

export function setDriverOnline(
  supabase: unknown,
  driverId: string,
  online: boolean,
): Promise<{ ok: boolean }>

export function fetchDriverApplication(
  supabase: unknown,
  driverId: string,
): Promise<{
  application: { onboarding_status?: string; rejection_reason?: string | null } | null
  error: string | null
}>

export function requestDriverTrip(
  supabase: unknown,
  input: {
    riderId: string
    driverId: string
    dest?: string
    destPoint?: { latitude: number; longitude: number }
    pickupLabel?: string
    pickupPoint?: { latitude: number; longitude: number }
    tier?: string
    isStudent?: boolean
  },
): Promise<{ id: string; status: string; driver_id: string; dropoff_label: string }>
