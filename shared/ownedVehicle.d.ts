export const DRIVER_RENTALS_BROWSE_URL: string
export const OWN_OR_LEASE_LABEL: string
export const RENT_FROM_PARTNER_LABEL: string
export const POOR_CONDITION_MESSAGE: string
export const LUXURY_PHOTOS_MESSAGE: string
export const LUXURY_EXCEPTION_MESSAGE: string

export type OwnedVehicleDecision =
  | { ok: true; year: number; luxuryException: boolean; message: string | null }
  | { ok: false; code: 'poor_condition' | 'condition_missing' | 'condition_invalid' | 'year_invalid' | 'luxury_photos'; message: string }

export function missingLuxuryExceptionColumn(error: unknown): boolean
export function isPreStandardYear(year: unknown, now?: Date): boolean
export function assessOwnedVehicle(
  input?: { year?: unknown; condition?: unknown; luxuryPhotos?: unknown },
  now?: Date,
): OwnedVehicleDecision
