export interface DepositStatusInfo {
  key: string
  label: string
  hint: string
  tone: 'warning' | 'info' | 'positive' | 'neutral' | 'critical' | string
}

export interface RefundStatusInfo {
  key: string
  label: string
  hint: string
  tone: 'info' | 'positive' | 'critical' | 'neutral' | string
}

export interface ReceiptLineItem {
  key: string
  label: string
  amountCents: number
  formatted: string
  type: 'charge' | 'credit' | 'balance' | 'total' | string
}

export interface ReceiptBreakdown {
  title: string
  tripId: string | null
  route: {
    from: string | null
    to: string | null
  }
  completedAt: string | null
  lines: ReceiptLineItem[]
  totalCents: number
  formattedTotal: string
  depositNotice: string | null
  notes: string[]
}

export interface DepositBreakdown {
  fareCents: number
  depositCents: number
  remainingCents: number
  fareFormatted: string
  depositFormatted: string
  remainingFormatted: string
  percentText: string
}

export declare const RECEIPT_HEADINGS: {
  readonly riderReceipt: string
  readonly driverEarnings: string
  readonly depositHold: string
  readonly refundNotice: string
  readonly refundSummary: string
}

export declare const RECEIPT_LINE_LABELS: {
  readonly fare: string
  readonly tripFare: string
  readonly baseFare: string
  readonly airportDeposit: string
  readonly fullAirportDeposit: string
  readonly remainingBalance: string
  readonly studentDiscount: string
  readonly surge: string
  readonly tip: string
  readonly driverTip: string
  readonly platformFee: string
  readonly driverPayout: string
  readonly total: string
  readonly totalCharged: string
  readonly totalPaid: string
  readonly refundIssued: string
  readonly cancellationFee: string
  readonly waitFee: string
}

export declare const DEPOSIT_STATUS_COPY: Record<string, { label: string; hint: string; tone: string }>
export declare const REFUND_STATUS_COPY: Record<string, { label: string; hint: string; tone: string }>
export declare const REFUND_REASONS: Record<string, string>
export declare const PAYMENT_FAILURE_REASONS: Record<string, string>

export declare const DEPOSIT_POLICY_NOTICE: string
export declare const REFUND_TIMELINE_NOTICE: string
export declare const PAYMENT_FAILURE_RECOVERY_NOTICE: string

export declare function formatReceiptMoney(cents: number | string | null | undefined): string
export declare function formatUsdCents(cents: number | string | null | undefined): string
export declare function formatDepositStatus(status: string | null | undefined): DepositStatusInfo
export declare function formatRefundStatus(status: string | null | undefined): RefundStatusInfo
export declare function formatRefundReason(reasonKey: string | null | undefined): string
export declare function formatPaymentFailureNotice(reasonOrCode: string | null | undefined): string
export declare function formatDepositBreakdown(input?: {
  fareCents?: number | string | null
  depositCents?: number | string | null
}): DepositBreakdown
export declare function buildReceiptBreakdown(
  trip: any,
  options?: { forDriver?: boolean }
): ReceiptBreakdown
export declare function formatReceiptPlainSummary(
  trip: any,
  options?: { forDriver?: boolean; includePolicy?: boolean }
): string
export declare function formatRefundSummaryText(options?: {
  refundCents?: number | string | null
  reason?: string | null
  status?: string | null
  referenceId?: string | null
}): string
