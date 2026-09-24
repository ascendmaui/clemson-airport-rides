import type { DriverCard } from './tripTags'

export type VehicleRow = {
  id: string
  make?: string | null
  model?: string | null
  color?: string | null
  plate?: string | null
  seats?: number | null
  is_tesla?: boolean | null
  autonomous_capable?: boolean | null
  tier?: string | null
}

export type FacingCard = {
  name: string
  phone: string | null
  ratingAvg: number | null
  ratingCount: number
  studentVerified: boolean
  vehicleLabel: string
  plate: string | null
  isTesla: boolean
  tier: string
  online: boolean
  seats: number | null
}

export type DriverDesk = {
  offers: DriverCard[]
  scheduledOpen: DriverCard[]
  upcoming: DriverCard[]
  active: DriverCard | null
  online: boolean
  priority: boolean
  lat?: number | null
  lng?: number | null
  vehicle: VehicleRow | null
  gameDay: { id?: string; title?: string; surge_multiplier?: number; pickup_zone_label?: string | null } | null
  profile: Record<string, unknown> | null
  facing?: FacingCard
  warning?: string | null
}

export function loadGameDay(supabase: unknown): Promise<{ title?: string; surge_multiplier?: number; pickup_zone_label?: string | null } | null>
export function loadVehicle(supabase: unknown, driverId: string): Promise<VehicleRow | null>
export function loadDriverProfile(supabase: unknown, driverId: string): Promise<Record<string, unknown> | null>
export function riderFacingCard(input: { profile: Record<string, unknown> | null; vehicle: VehicleRow | null; online: boolean }): FacingCard
export function setPriorityMode(supabase: unknown, driverId: string, on: boolean): Promise<void>
export function publishDriverLocation(
  supabase: unknown,
  driverId: string,
  fix: { lat: number; lng: number; heading?: number | null; online?: boolean },
): Promise<void>
export function setTeslaListing(
  supabase: unknown,
  driverId: string,
  input: { enabled: boolean; claimModel3?: boolean },
): Promise<VehicleRow>
export function loadDriverDesk(supabase: unknown, driverId: string): Promise<DriverDesk>
export function subscribeTrips(supabase: unknown, onChange: () => void): () => void
export function publishDriverCapacity(
  supabase: unknown,
  driverId: string,
  seats: number | null | undefined,
): Promise<{ seats: number | null; stored: boolean }>
export function listPassedTripIds(supabase: unknown, driverId: string): Promise<string[]>
export function acceptTrip(supabase: unknown, trip: { id: string; status: string }, driverId: string): Promise<unknown>
export function declineTrip(
  supabase: unknown,
  tripOrId: string | { id: string; status?: string },
  driverId?: string | null,
): Promise<{ disposition: 'release' | 'leave' | 'cancel'; passed?: boolean; released?: boolean }>
export function loadRiderFix(
  supabase: unknown,
  tripId: string,
): Promise<{ latitude: number; longitude: number; updatedAt: string | null } | null>
export function advanceTrip(
  supabase: unknown,
  trip: { id: string; status: string },
  driverId: string,
): Promise<{ status?: string; settle?: { payment?: unknown; payout?: { status?: string; amountCents?: number } | null } | null }>
export function loadTrip(supabase: unknown, tripId: string, driverId?: string): Promise<DriverCard | null>
export function loadEarnings(supabase: unknown, driverId: string): Promise<{
  trips: { id: string; status?: string; fare_cents?: number; dropoff_label?: string | null; completed_at?: string | null; pickup_label?: string | null; metadata?: Record<string, unknown> | null }[]
  paymentsByTrip: Record<string, { kind?: string; amountCents?: number; status?: string }[]>
  payouts: { paidCents?: number; pendingCents?: number; pending?: unknown[] } | null
  summary: {
    depositPaidCents: number
    depositOpenCents: number
    driverNetCents: number
    todayNetCents: number
    lines: { tripId: string; dropoff: string; line: string; fareCents: number }[]
  }
  apiError: string | null
  payoutError: string | null
}>
export function formatCents(cents: number): string
