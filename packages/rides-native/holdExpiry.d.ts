export const UNPAID_AIRPORT_HOLD_TTL_MS: number

export const HOLD_EXPIRED_LABEL: string
export const HOLD_LAST_MINUTE_LABEL: string

export type HoldTrip = {
  created_at?: string | null
  metadata?: {
    stripe_checkout_created_at?: string | null
  } | null
} | null

export type HoldRemaining = {
  msLeft: number | null
  expired: boolean
  label: string
}

export function holdDeadline(trip: HoldTrip, ttlMs?: number): number | null

export function holdRemaining(
  trip: HoldTrip,
  now?: number | Date | string | null,
  ttlMs?: number,
): HoldRemaining
