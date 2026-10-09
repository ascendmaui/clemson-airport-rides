export const AUTO_NAV_ACCEPT_WINDOW_MS: number
export const AUTO_NAV_SCHEDULED_LEAD_MS: number
export type AutoNavLeg = 'pickup' | 'dropoff'
export function autoNavigationLeg(input?: {
  status?: string | null
  enabled?: boolean
  launched?: string[]
  acceptedAt?: string | null
  pickupAt?: string | null
  now?: number
}): AutoNavLeg | null
export function autoNavigationKey(tripId: string): string
export function readLaunchedLegs(raw: string | null | undefined): AutoNavLeg[]
export function withLaunchedLeg(legs: string[] | null | undefined, leg: AutoNavLeg): AutoNavLeg[]
