/**
 * Canonical receipt, deposit, and refund copy dictionary and formatters.
 * Normalizes payment summary terminology across mobile and web platforms.
 */
import { depositSplit } from '../../src/lib/fareRates.js'
import { maskCompletedTripForDriver } from '../../src/lib/privacyDisplay.js'

export const RECEIPT_HEADINGS = Object.freeze({
  riderReceipt: 'Clemson RIDES receipt',
  driverEarnings: 'Driver trip summary',
  depositHold: 'Airport reservation deposit',
  refundNotice: 'Clemson RIDES refund confirmation',
  refundSummary: 'Refund summary',
})

export const RECEIPT_LINE_LABELS = Object.freeze({
  fare: 'Fare',
  tripFare: 'Trip fare',
  baseFare: 'Standard base fare',
  airportDeposit: '25% deposit',
  fullAirportDeposit: '25% airport deposit',
  remainingBalance: 'Remaining balance',
  studentDiscount: 'Clemson student discount (10%)',
  surge: 'Peak demand surge',
  tip: 'Tip',
  driverTip: 'Driver tip',
  platformFee: 'Platform service fee',
  driverPayout: 'Driver net payout',
  total: 'Total',
  totalCharged: 'Total charged',
  totalPaid: 'Total paid',
  refundIssued: 'Refund issued',
  cancellationFee: 'Cancellation fee',
  waitFee: 'Wait time fee',
})

export const DEPOSIT_STATUS_COPY = Object.freeze({
  unpaid: Object.freeze({
    label: 'Deposit pending',
    hint: 'Payment required to hold reservation',
    tone: 'warning',
  }),
  holding: Object.freeze({
    label: 'Deposit held',
    hint: 'Temporary reservation hold placed on card',
    tone: 'info',
  }),
  paid: Object.freeze({
    label: 'Deposit paid',
    hint: '25% deposit collected at booking',
    tone: 'positive',
  }),
  applied: Object.freeze({
    label: 'Deposit applied',
    hint: 'Full deposit credited toward final trip fare',
    tone: 'positive',
  }),
  refunded: Object.freeze({
    label: 'Deposit refunded',
    hint: 'Returned to original payment method',
    tone: 'neutral',
  }),
  forfeited: Object.freeze({
    label: 'Deposit retained',
    hint: 'Cancellation fee applied per policy',
    tone: 'critical',
  }),
})

export const REFUND_STATUS_COPY = Object.freeze({
  pending: Object.freeze({
    label: 'Refund processing',
    hint: 'Initiated; typically settles in 3–5 business days',
    tone: 'info',
  }),
  succeeded: Object.freeze({
    label: 'Refund issued',
    hint: 'Funds returned to original payment card',
    tone: 'positive',
  }),
  failed: Object.freeze({
    label: 'Refund unsuccessful',
    hint: 'Unable to process refund. Contact support.',
    tone: 'critical',
  }),
})

export const REFUND_REASONS = Object.freeze({
  driver_cancelled: 'Driver cancelled · 100% deposit refunded',
  driver_no_show: 'Driver did not arrive · 100% deposit refunded',
  rider_cancelled_early: 'Free advance cancellation · full refund',
  rider_cancelled_late: 'Late cancellation fee applied',
  no_driver_found: 'No driver accepted · automatic full refund',
  fare_adjustment: 'Fare adjustment credit',
  service_credit: 'Customer support courtesy credit',
  duplicate_charge: 'Duplicate transaction correction',
})

export const DEPOSIT_POLICY_NOTICE =
  'Airport reservations require a 25% deposit at booking. The remaining balance is billed upon trip completion. Cancellations made at least 2 hours before pickup receive a 100% refund.'

export const REFUND_TIMELINE_NOTICE =
  'Refunds are returned to the original payment method and typically appear in 3–5 business days.'

export const PAYMENT_FAILURE_RECOVERY_NOTICE =
  'Payment could not be completed. Please update your card or select an alternate payment method to prevent reservation cancellation.'

export const PAYMENT_FAILURE_REASONS = Object.freeze({
  insufficient_funds: 'Insufficient funds. Please use an alternate card to secure your reservation.',
  card_declined: 'Card declined. Please check your card details or use a different payment method.',
  expired_card: 'Card is expired. Please enter an updated expiration date or new card.',
  processing_error: 'Payment processing error. Please retry in a few moments.',
  hold_expired: 'Reservation hold expired before payment was authorized.',
})

export function formatReceiptMoney(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  const rem = String(abs % 100).padStart(2, '0')
  return `${sign}$${dollars}.${rem}`
}

export const formatUsdCents = formatReceiptMoney

export function formatDepositStatus(status) {
  const norm = String(status || 'unpaid').toLowerCase().trim()
  if (norm === 'pending') {
    return { key: 'unpaid', ...DEPOSIT_STATUS_COPY.unpaid }
  }
  if (norm === 'hold' || norm === 'authorized') {
    return { key: 'holding', ...DEPOSIT_STATUS_COPY.holding }
  }
  if (norm === 'succeeded' || norm === 'complete' || norm === 'completed') {
    return { key: 'paid', ...DEPOSIT_STATUS_COPY.paid }
  }
  if (DEPOSIT_STATUS_COPY[norm]) {
    return { key: norm, ...DEPOSIT_STATUS_COPY[norm] }
  }
  return {
    key: norm,
    label: norm.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    hint: 'Deposit status update',
    tone: 'neutral',
  }
}

export function formatRefundStatus(status) {
  const norm = String(status || 'pending').toLowerCase().trim()
  if (norm === 'in_progress' || norm === 'processing') {
    return { key: 'pending', ...REFUND_STATUS_COPY.pending }
  }
  if (norm === 'paid' || norm === 'completed' || norm === 'complete' || norm === 'success') {
    return { key: 'succeeded', ...REFUND_STATUS_COPY.succeeded }
  }
  if (norm === 'error' || norm === 'canceled' || norm === 'cancelled') {
    return { key: 'failed', ...REFUND_STATUS_COPY.failed }
  }
  if (REFUND_STATUS_COPY[norm]) {
    return { key: norm, ...REFUND_STATUS_COPY[norm] }
  }
  return {
    key: norm,
    label: norm.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    hint: 'Refund status update',
    tone: 'neutral',
  }
}

export function formatRefundReason(reasonKey) {
  if (!reasonKey) return 'Standard refund'
  const norm = String(reasonKey).toLowerCase().trim().replace(/[-\s]/g, '_')
  if (REFUND_REASONS[norm]) {
    return REFUND_REASONS[norm]
  }
  return norm.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatPaymentFailureNotice(reasonOrCode) {
  const norm = String(reasonOrCode || '').toLowerCase().trim().replace(/[-\s]/g, '_')
  if (PAYMENT_FAILURE_REASONS[norm]) {
    return PAYMENT_FAILURE_REASONS[norm]
  }
  return PAYMENT_FAILURE_RECOVERY_NOTICE
}

export function formatDepositBreakdown({ fareCents, depositCents } = {}) {
  const split = depositSplit(fareCents, depositCents)
  return {
    fareCents: split.fareCents,
    depositCents: split.depositCents,
    remainingCents: split.remainingCents,
    fareFormatted: formatReceiptMoney(split.fareCents),
    depositFormatted: formatReceiptMoney(split.depositCents),
    remainingFormatted: formatReceiptMoney(split.remainingCents),
    percentText: '25%',
  }
}

export function buildReceiptBreakdown(trip, { forDriver = false } = {}) {
  const title = forDriver ? RECEIPT_HEADINGS.driverEarnings : RECEIPT_HEADINGS.riderReceipt
  if (!trip) {
    return {
      title,
      tripId: null,
      route: { from: null, to: null },
      completedAt: null,
      lines: [],
      totalCents: 0,
      formattedTotal: '$0.00',
      depositNotice: null,
      notes: [DEPOSIT_POLICY_NOTICE],
    }
  }

  const view = forDriver && typeof maskCompletedTripForDriver === 'function'
    ? maskCompletedTripForDriver(trip)
    : trip

  const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
  const tip = Math.max(0, Math.round(Number(trip.tip_cents) || 0))
  const lines = []

  lines.push({
    key: 'fare',
    label: RECEIPT_LINE_LABELS.fare,
    amountCents: fare,
    formatted: formatReceiptMoney(fare),
    type: 'charge',
  })

  const storedDeposit = trip.deposit_cents
  let depositNotice = null
  if (storedDeposit != null && storedDeposit !== '') {
    const split = depositSplit(fare, storedDeposit)
    if (split.depositCents > 0) {
      lines.push({
        key: 'deposit',
        label: RECEIPT_LINE_LABELS.airportDeposit,
        amountCents: split.depositCents,
        formatted: formatReceiptMoney(split.depositCents),
        type: 'credit',
      })
      lines.push({
        key: 'remaining',
        label: RECEIPT_LINE_LABELS.remainingBalance,
        amountCents: split.remainingCents,
        formatted: formatReceiptMoney(split.remainingCents),
        type: 'balance',
      })
      depositNotice = `25% deposit: ${formatReceiptMoney(split.depositCents)} · Remaining: ${formatReceiptMoney(split.remainingCents)}`
    }
  }

  if (tip > 0) {
    lines.push({
      key: 'tip',
      label: RECEIPT_LINE_LABELS.tip,
      amountCents: tip,
      formatted: formatReceiptMoney(tip),
      type: 'charge',
    })
  }

  const totalCents = fare + tip
  lines.push({
    key: 'total',
    label: RECEIPT_LINE_LABELS.total,
    amountCents: totalCents,
    formatted: formatReceiptMoney(totalCents),
    type: 'total',
  })

  return {
    title,
    tripId: trip.id || null,
    route: {
      from: view.pickup_label || 'Pickup',
      to: view.dropoff_label || 'Dropoff',
    },
    completedAt: trip.completed_at || null,
    lines,
    totalCents,
    formattedTotal: formatReceiptMoney(totalCents),
    depositNotice,
    notes: [DEPOSIT_POLICY_NOTICE],
  }
}

export function formatReceiptPlainSummary(trip, { forDriver = false, includePolicy = false } = {}) {
  if (!trip) return RECEIPT_HEADINGS.riderReceipt
  const view = forDriver && typeof maskCompletedTripForDriver === 'function'
    ? maskCompletedTripForDriver(trip)
    : trip
  const breakdown = buildReceiptBreakdown(trip, { forDriver })
  const when = trip.completed_at
    ? new Date(trip.completed_at).toLocaleString()
    : null

  const lines = [
    breakdown.title,
    trip.id ? `Trip ${trip.id}` : null,
    `From: ${view.pickup_label || 'Pickup'}`,
    `To: ${view.dropoff_label || 'Dropoff'}`,
    when ? `Completed: ${when}` : null,
  ]

  for (const item of breakdown.lines) {
    lines.push(`${item.label}: ${item.formatted}`)
  }

  if (includePolicy) {
    lines.push(`Policy: ${DEPOSIT_POLICY_NOTICE}`)
  }

  return lines.filter(Boolean).join('\n')
}

export function formatRefundSummaryText({
  refundCents,
  reason,
  status = 'succeeded',
  referenceId,
} = {}) {
  const statusInfo = formatRefundStatus(status)
  const reasonText = formatRefundReason(reason)
  const amountFormatted = formatReceiptMoney(refundCents)
  const lines = [
    RECEIPT_HEADINGS.refundNotice,
    referenceId ? `Reference: ${referenceId}` : null,
    `Status: ${statusInfo.label} (${statusInfo.hint})`,
    reason ? `Reason: ${reasonText}` : null,
    `Refund amount: ${amountFormatted}`,
    `Timeline: ${REFUND_TIMELINE_NOTICE}`,
  ]
  return lines.filter(Boolean).join('\n')
}
