export function navigationLinks(input?: {
  latitude?: number | null
  longitude?: number | null
  label?: string | null
}): { apple: string; google: string; hasPoint: boolean }

export function preferredNavigationUrl(
  stop?: {
    latitude?: number | null
    longitude?: number | null
    label?: string | null
  },
  userAgent?: string,
): string
