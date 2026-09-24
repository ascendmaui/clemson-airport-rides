export const PASSWORD_RESET_REDIRECT: string

export const AIRPORT_QUOTES: Record<string, { code: string; name: string; miles: number; minutes: number }>

export const FAVORITE_SPOTS: string[]

export const RIDE_PLACES: { label: string; lat: number; lng: number }[]

export function parseRecoveryUrl(url: string | null | undefined): {
  accessToken: string | null
  refreshToken: string | null
  code: string | null
  type: string | null
} | null

export function meteredFareCents(miles: number, minutes: number): number
export function airportFareCents(code: string): number | null
export function depositCents(fareCents: number): number
export function applyStudentDiscount(fareCents: number, isStudent: boolean): {
  fareCents: number
  discountCents: number
  label: string | null
}
export function haversineMeters(
  a: { lat: number; lng: number } | null | undefined,
  b: { lat: number; lng: number } | null | undefined,
): number | null
export function distanceFareCents(meters: number): number
export function campusOverlays(date?: Date): { gameDay: boolean; surge: boolean; surgeLabel: string | null }
export function nextPickupDate(input: {
  date?: string
  time?: string
  weekdays?: string[]
  now?: Date
}): Date | null
export function localDateInput(date: Date): string
export function localTimeInput(date: Date): string
export function searchDelayMs(random?: () => number): number
