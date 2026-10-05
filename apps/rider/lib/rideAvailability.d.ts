export const RIDE_AVAILABILITY_PATH: string
export const AVAILABILITY_POLL_MS: number
export const APP_RIDE_TIERS: readonly ['standard', 'wait', 'comfort']

export type AppRideTier = 'standard' | 'wait' | 'comfort'

export type TierQuote = {
  listCents: number
  fareCents: number
}

export type RidePlaceInput = {
  label: string
  lat: number
  lng: number
}

export function isAppRideTier(value: unknown): value is AppRideTier

export function availabilityRequestBody(input?: {
  scheduledFor?: string | null
  pickup?: RidePlaceInput | null
  dropoff?: RidePlaceInput | null
}): {
  scheduled_for?: string
  pickup?: RidePlaceInput
  dropoff?: RidePlaceInput
}

export function parseRideAvailability(payload: unknown): {
  tiers: AppRideTier[]
  quotes: Partial<Record<AppRideTier, TierQuote>>
}
