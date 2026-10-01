export type CanonicalTripStatus =
  | 'searching'
  | 'offered'
  | 'requested'
  | 'scheduled'
  | 'accepted'
  | 'arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'canceled'
  | 'cancelled_wait'
  | 'canceled_midride'

export type RideBadgeTone = 'orange' | 'purple' | 'green' | 'danger' | 'neutral'

export const CANONICAL_TRIP_STATUSES: readonly CanonicalTripStatus[]

export function normalizeTripStatus(raw: unknown): string

export const RIDE_STATUS_LABELS: Readonly<Record<CanonicalTripStatus, string>>

export const RIDER_STATUS_TITLES: Readonly<Record<CanonicalTripStatus, string>>

export const DRIVER_STATUS_HEADLINES: Readonly<Record<CanonicalTripStatus, string>>

export const RIDE_STATUS_BADGE_TONES: Readonly<Record<CanonicalTripStatus, RideBadgeTone>>

export function getRideStatusLabel(
  status: string | null | undefined,
  options?: { fallback?: string },
): string

export function getRideStatusBadgeTone(
  status: string | null | undefined,
  fallback?: RideBadgeTone,
): RideBadgeTone

export function getDriverStatusHeadline(status: string | null | undefined): string

export function getRiderStatusTitle(
  status: string | null | undefined,
  options?: { preferred?: boolean },
): string
