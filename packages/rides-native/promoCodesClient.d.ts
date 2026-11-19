export const PROMO_DEVICE_KEY: string

export function promoDeviceId(storage: unknown): Promise<string | null>

export function checkPromoCode(
  supabase: unknown,
  options?: {
    code?: string
    side?: string
    fareCents?: number
    fetch?: typeof fetch
  },
): Promise<{
  ok?: boolean
  code?: string
  reason?: string
  message?: string
  [key: string]: any
}>

export function claimCampaignPromo(
  supabase: unknown,
  options?: {
    code?: string
    side?: string
    deviceId?: string | null
    fetch?: typeof fetch
  },
): Promise<{
  ok?: boolean
  code?: string
  reason?: string
  message?: string
  [key: string]: any
}>
