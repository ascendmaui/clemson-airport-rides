export declare const PREFERRED_CANCELED_COPY: string

export type CancellationInitiator = 'rider' | 'driver' | 'system'

export type CancellationReasonInfo = {
  code: string
  initiator: CancellationInitiator
  shortLabel: string
  riderHeadline: string
  riderExplanation: string
  driverHeadline: string
  driverExplanation: string
  aliases: readonly string[]
}

export declare const CANCELLATION_REASONS: Record<string, CancellationReasonInfo>
export declare const CANCELLATION_REASON_CODES: readonly string[]

export type CancellationOption = {
  id: string
  label: string
  description: string
}

export declare const RIDER_CANCELLATION_OPTIONS: readonly CancellationOption[]
export declare const DRIVER_CANCELLATION_OPTIONS: readonly CancellationOption[]

export declare function normalizeCancellationReason(input: unknown): string | null
export declare function extractCancellationReason(trip: unknown): string | null

export type CancellationCopyResult = {
  code: string
  initiator: CancellationInitiator | 'unknown'
  shortLabel: string
  headline: string
  explanation: string
  isPreferredDeclined: boolean
  isHoldExpired: boolean
  isAutoWaitCancel: boolean
  isMidrideCancel: boolean
}

export declare function getCancellationCopy(
  reasonOrTrip: unknown,
  options?: {
    role?: 'rider' | 'driver'
    preferred?: boolean
    fallbackHeadline?: string
    fallbackExplanation?: string
  }
): CancellationCopyResult
