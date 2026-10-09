export function navigationLinks(input?: {
  latitude?: number | null
  longitude?: number | null
  label?: string | null
}): { apple: string; google: string; waze: string; hasPoint: boolean }

export type NavApp = 'apple' | 'google' | 'waze'
export const NAV_APPS: readonly NavApp[]
export function isNavApp(value: unknown): value is NavApp
export function navAppLabel(app: NavApp | string | null | undefined): string
export function navAppOrder(preferred: NavApp | string | null | undefined): NavApp[]
export function navigationUrl(
  app: NavApp | string | null | undefined,
  stop?: { latitude?: number | null; longitude?: number | null; label?: string | null },
): string

export function preferredNavigationUrl(
  stop?: {
    latitude?: number | null
    longitude?: number | null
    label?: string | null
  },
  userAgent?: string,
): string
