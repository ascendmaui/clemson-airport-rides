export type RegisteredVehicle = {
  id?: string
  make?: string | null
  model?: string | null
  color?: string | null
  plate?: string | null
  seats?: number | null
  is_tesla?: boolean | null
  tier?: string | null
}

export type OfferCapacity = {
  seats: number
  cap: number
  title: string
  plate: string
  message: string
}

export type VehicleClient = {
  from: (table: string) => any
} | null

export const DEFAULT_MAX_PARTICIPANTS: number
export function inferVehicleCategory(vehicle: RegisteredVehicle | null): string | null
export function vehicleMaxSeats(vehicle: RegisteredVehicle | null): number
export function carpoolSeatCap(input: {
  kind?: string
  partyType?: string
  matchMode?: string
  vehicleSeats?: number
}): number
export function capacityMessage(max: number, options?: { hasVehicle?: boolean }): string
export function vehicleTitle(vehicle: RegisteredVehicle | null): string
export function offerCapacity(vehicle: RegisteredVehicle | null, options?: { tailgate?: boolean }): OfferCapacity | null
export function loadRegisteredVehicle(supabase: VehicleClient, userId: string): Promise<RegisteredVehicle | null>
export function saveRegisteredVehicle(
  supabase: VehicleClient,
  userId: string,
  payload: { make?: string; model?: string; color?: string; plate?: string; seats?: number; isTesla?: boolean },
): Promise<RegisteredVehicle>
