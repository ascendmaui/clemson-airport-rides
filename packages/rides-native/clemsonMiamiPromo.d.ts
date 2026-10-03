export const CLEMSON_MIAMI_RIDE: string
export const CLEMSON_MIAMI_PROMO_ID: string
export const CLEMSON_MIAMI_FARE_CENTS: number
export const CLEMSON_MIAMI_PUBLIC_URL: string
export const CLEMSON_MIAMI_PICKUP: { label: string; lat: number; lng: number }
export const CLEMSON_MIAMI_DROPOFF: { label: string; lat: number; lng: number }
export const CLEMSON_MIAMI_START_MS: number
export const CLEMSON_MIAMI_END_MS: number
export function clemsonMiamiPromoOpen(now?: Date | number | string): boolean
export function clemsonMiamiRemainingLabel(now?: Date | number | string): string
export function clemsonMiamiDriverNotification(now?: Date | number | string): { title: string; body: string }
export function isClemsonMiamiPromoRow(row: { status?: string; metadata?: Record<string, unknown> | null } | null | undefined): boolean
