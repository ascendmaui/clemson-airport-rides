export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'canceled'

export type PayoutBadgeTone = 'orange' | 'green' | 'danger' | 'neutral'

export const DRIVER_SHARE_PERCENT: number
export const PLATFORM_FEE_PERCENT: number

export const PAYOUT_STATUS_LABELS: Readonly<Record<PayoutStatus, string>>

export const PAYOUT_STATUS_BADGE_TONES: Readonly<Record<PayoutStatus, PayoutBadgeTone>>

export const INCENTIVE_LABELS: Readonly<Record<string, string>>

export function formatIncentiveName(rawId: string | null | undefined): string

export function getPayoutStatusLabel(status: string | null | undefined): string

export function getPayoutStatusBadgeTone(status: string | null | undefined): PayoutBadgeTone

export function formatWeeklyEarningsNote(options?: {
  weekNetCents?: number
  hasCarpoolBonus?: boolean
}): string

export function formatFareBreakdownExplanation(options?: {
  standard?: boolean
  hasCarpoolBonus?: boolean
}): string

export function formatWalletBalanceNote(options?: {
  pendingCents?: number
  nextRetryAt?: string | null
}): string
