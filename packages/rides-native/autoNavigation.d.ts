export const AUTO_NAV_ACCEPT_WINDOW_MS: number
export const AUTO_NAV_SCHEDULED_LEAD_MS: number
export type AutoNavLeg = 'pickup' | 'dropoff' | `stop:${number}`
export function autoNavigationLeg(input?: {
  status?: string | null
  enabled?: boolean
  launched?: string[]
  acceptedAt?: string | null
  pickupAt?: string | null
  now?: number
}): AutoNavLeg | null
export function autoNavigationStopLeg(input?: { enabled?: boolean; launched?: string[]; stopIndex?: number | null }): AutoNavLeg | null
export function autoNavigationKey(tripId: string): string
export function readLaunchedLegs(raw: string | null | undefined): AutoNavLeg[]
export function withLaunchedLeg(legs: string[] | null | undefined, leg: AutoNavLeg): AutoNavLeg[]

export type PickupNavigationStop = {
  latitude: number | null
  longitude: number | null
  label: string
}

export function pickupNavigationTarget(card?: {
  pickupLat?: number | string | null
  pickupLng?: number | string | null
  pickupLabel?: string | null
  pickup_lat?: number | string | null
  pickup_lng?: number | string | null
  pickup_label?: string | null
} | null): PickupNavigationStop

export function preferredNavApp(navApp: unknown): 'apple' | 'google' | 'waze' | null

export function navigatePickupAfterAccept<T>(input?: {
  accept?: () => Promise<T> | T
  openNav?: (app: 'apple' | 'google' | 'waze' | null, stop: PickupNavigationStop) => Promise<unknown> | unknown
  navApp?: unknown
  pickup?: {
    pickupLat?: number | string | null
    pickupLng?: number | string | null
    pickupLabel?: string | null
    pickup_lat?: number | string | null
    pickup_lng?: number | string | null
    pickup_label?: string | null
  } | null
  enabled?: boolean
}): Promise<T>
