export function navigationLinks(input?: {
  latitude?: number | null
  longitude?: number | null
  label?: string | null
}): { apple: string; google: string; hasPoint: boolean }
