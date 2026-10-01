import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RECEIPT_HEADINGS,
  RECEIPT_LINE_LABELS,
  DEPOSIT_STATUS_COPY,
  REFUND_STATUS_COPY,
  REFUND_REASONS,
  DEPOSIT_POLICY_NOTICE,
  REFUND_TIMELINE_NOTICE,
  PAYMENT_FAILURE_RECOVERY_NOTICE,
  formatReceiptMoney,
  formatDepositStatus,
  formatRefundStatus,
  formatRefundReason,
  formatPaymentFailureNotice,
  formatDepositBreakdown,
  buildReceiptBreakdown,
  formatReceiptPlainSummary,
  formatRefundSummaryText,
} from '../packages/rides-native/receiptCopy.js'

test('receiptCopy constants: taxonomy, labels, and notices are defined and frozen', () => {
  assert.equal(RECEIPT_HEADINGS.riderReceipt, 'Clemson RIDES receipt')
  assert.equal(RECEIPT_HEADINGS.driverEarnings, 'Driver trip summary')
  assert.equal(RECEIPT_HEADINGS.refundNotice, 'Clemson RIDES refund confirmation')

  assert.equal(RECEIPT_LINE_LABELS.fare, 'Fare')
  assert.equal(RECEIPT_LINE_LABELS.airportDeposit, '25% deposit')
  assert.equal(RECEIPT_LINE_LABELS.remainingBalance, 'Remaining balance')
  assert.equal(RECEIPT_LINE_LABELS.total, 'Total')

  assert.ok(DEPOSIT_STATUS_COPY.unpaid)
  assert.ok(DEPOSIT_STATUS_COPY.paid)
  assert.ok(DEPOSIT_STATUS_COPY.refunded)
  assert.ok(REFUND_STATUS_COPY.pending)
  assert.ok(REFUND_STATUS_COPY.succeeded)
  assert.ok(REFUND_STATUS_COPY.failed)

  assert.ok(DEPOSIT_POLICY_NOTICE.includes('25% deposit'))
  assert.ok(REFUND_TIMELINE_NOTICE.includes('3–5 business days'))
  assert.ok(PAYMENT_FAILURE_RECOVERY_NOTICE.includes('Payment could not be completed'))
})

test('formatReceiptMoney: formats cents into standardized USD currency strings', () => {
  assert.equal(formatReceiptMoney(0), '$0.00')
  assert.equal(formatReceiptMoney(100), '$1.00')
  assert.equal(formatReceiptMoney(2250), '$22.50')
  assert.equal(formatReceiptMoney('9000'), '$90.00')
  assert.equal(formatReceiptMoney(123456), '$1,234.56')
  assert.equal(formatReceiptMoney(-500), '-$5.00')
  assert.equal(formatReceiptMoney(null), '$0.00')
  assert.equal(formatReceiptMoney(undefined), '$0.00')
})

test('formatDepositStatus: resolves status keys, hints, tones, and aliases', () => {
  const unpaid = formatDepositStatus('unpaid')
  assert.equal(unpaid.key, 'unpaid')
  assert.equal(unpaid.label, 'Deposit pending')
  assert.equal(unpaid.tone, 'warning')

  const pending = formatDepositStatus('pending')
  assert.equal(pending.key, 'unpaid')
  assert.equal(pending.label, 'Deposit pending')

  const paid = formatDepositStatus('paid')
  assert.equal(paid.key, 'paid')
  assert.equal(paid.label, 'Deposit paid')
  assert.equal(paid.tone, 'positive')

  const completed = formatDepositStatus('completed')
  assert.equal(completed.key, 'paid')

  const authorized = formatDepositStatus('authorized')
  assert.equal(authorized.key, 'holding')
  assert.equal(authorized.label, 'Deposit held')
  assert.equal(authorized.tone, 'info')

  const custom = formatDepositStatus('in_review')
  assert.equal(custom.key, 'in_review')
  assert.equal(custom.label, 'In Review')
  assert.equal(custom.tone, 'neutral')
})

test('formatRefundStatus: resolves refund states, tones, and aliases', () => {
  const pending = formatRefundStatus('pending')
  assert.equal(pending.key, 'pending')
  assert.equal(pending.label, 'Refund processing')
  assert.equal(pending.tone, 'info')

  const processing = formatRefundStatus('processing')
  assert.equal(processing.key, 'pending')

  const succeeded = formatRefundStatus('succeeded')
  assert.equal(succeeded.key, 'succeeded')
  assert.equal(succeeded.label, 'Refund issued')
  assert.equal(succeeded.tone, 'positive')

  const complete = formatRefundStatus('completed')
  assert.equal(complete.key, 'succeeded')

  const failed = formatRefundStatus('failed')
  assert.equal(failed.key, 'failed')
  assert.equal(failed.label, 'Refund unsuccessful')
  assert.equal(failed.tone, 'critical')

  const errorStatus = formatRefundStatus('error')
  assert.equal(errorStatus.key, 'failed')
})

test('formatRefundReason: formats standardized and custom refund reasons', () => {
  assert.equal(formatRefundReason('driver_cancelled'), 'Driver cancelled · 100% deposit refunded')
  assert.equal(formatRefundReason('rider_cancelled_early'), 'Free advance cancellation · full refund')
  assert.equal(formatRefundReason('no_driver_found'), 'No driver accepted · automatic full refund')
  assert.equal(formatRefundReason(null), 'Standard refund')
  assert.equal(formatRefundReason(''), 'Standard refund')
  assert.equal(formatRefundReason('special_dispute_case'), 'Special Dispute Case')
})

test('formatPaymentFailureNotice: returns clear recovery guidance based on code', () => {
  assert.ok(formatPaymentFailureNotice('insufficient_funds').includes('Insufficient funds'))
  assert.ok(formatPaymentFailureNotice('card_declined').includes('Card declined'))
  assert.ok(formatPaymentFailureNotice('expired_card').includes('expired'))
  assert.equal(formatPaymentFailureNotice('unknown_err'), PAYMENT_FAILURE_RECOVERY_NOTICE)
  assert.equal(formatPaymentFailureNotice(null), PAYMENT_FAILURE_RECOVERY_NOTICE)
})

test('formatDepositBreakdown: calculates deposit, fare, and remainder with 25% policy', () => {
  const breakdown = formatDepositBreakdown({ fareCents: 9000 })
  assert.equal(breakdown.fareCents, 9000)
  assert.equal(breakdown.depositCents, 2250)
  assert.equal(breakdown.remainingCents, 6750)
  assert.equal(breakdown.fareFormatted, '$90.00')
  assert.equal(breakdown.depositFormatted, '$22.50')
  assert.equal(breakdown.remainingFormatted, '$67.50')
  assert.equal(breakdown.percentText, '25%')

  const explicit = formatDepositBreakdown({ fareCents: 10000, depositCents: 2500 })
  assert.equal(explicit.depositFormatted, '$25.00')
  assert.equal(explicit.remainingFormatted, '$75.00')
})

test('buildReceiptBreakdown: generates structured breakdown and respects privacy for driver', () => {
  const empty = buildReceiptBreakdown(null)
  assert.equal(empty.title, 'Clemson RIDES receipt')
  assert.equal(empty.totalCents, 0)
  assert.equal(empty.lines.length, 0)

  const trip = {
    id: 'trip-gsp-888',
    pickup_label: '100 College Ave, Clemson, SC',
    dropoff_label: 'Greenville-Spartanburg Airport (GSP)',
    fare_cents: 8000,
    deposit_cents: 2000,
    tip_cents: 1500,
    completed_at: '2026-09-30T14:30:00Z',
  }

  const riderBreakdown = buildReceiptBreakdown(trip)
  assert.equal(riderBreakdown.title, 'Clemson RIDES receipt')
  assert.equal(riderBreakdown.tripId, 'trip-gsp-888')
  assert.equal(riderBreakdown.route.from, '100 College Ave, Clemson, SC')
  assert.equal(riderBreakdown.totalCents, 9500)
  assert.equal(riderBreakdown.formattedTotal, '$95.00')
  assert.ok(riderBreakdown.lines.some((l) => l.key === 'fare' && l.formatted === '$80.00'))
  assert.ok(riderBreakdown.lines.some((l) => l.key === 'deposit' && l.formatted === '$20.00'))
  assert.ok(riderBreakdown.lines.some((l) => l.key === 'remaining' && l.formatted === '$60.00'))
  assert.ok(riderBreakdown.lines.some((l) => l.key === 'tip' && l.formatted === '$15.00'))
  assert.ok(riderBreakdown.lines.some((l) => l.key === 'total' && l.formatted === '$95.00'))

  const driverBreakdown = buildReceiptBreakdown(trip, { forDriver: true })
  assert.equal(driverBreakdown.title, 'Driver trip summary')
  // Driver view masks pickup to downtown
  assert.equal(driverBreakdown.route.from, 'Clemson · downtown')
})

test('formatReceiptPlainSummary: produces clean multiline text matching receipt standards', () => {
  const nullTripText = formatReceiptPlainSummary(null)
  assert.equal(nullTripText, 'Clemson RIDES receipt')

  const trip = {
    id: 'trip-plane-101',
    pickup_label: 'Douthit Hills',
    dropoff_label: 'GSP Airport',
    fare_cents: 9000,
    deposit_cents: 2250,
    tip_cents: 1000,
    completed_at: '2026-10-01T12:00:00Z',
  }

  const text = formatReceiptPlainSummary(trip, { includePolicy: true })
  assert.ok(text.includes('Clemson RIDES receipt'))
  assert.ok(text.includes('Trip trip-plane-101'))
  assert.ok(text.includes('From: Douthit Hills'))
  assert.ok(text.includes('To: GSP Airport'))
  assert.ok(text.includes('Fare: $90.00'))
  assert.ok(text.includes('25% deposit: $22.50'))
  assert.ok(text.includes('Remaining balance: $67.50'))
  assert.ok(text.includes('Tip: $10.00'))
  assert.ok(text.includes('Total: $100.00'))
  assert.ok(text.includes('Policy: Airport reservations require a 25% deposit at booking.'))
})

test('formatRefundSummaryText: generates complete refund confirmation message', () => {
  const summary = formatRefundSummaryText({
    refundCents: 2250,
    reason: 'driver_cancelled',
    status: 'succeeded',
    referenceId: 'ref_stripe_123',
  })

  assert.ok(summary.includes('Clemson RIDES refund confirmation'))
  assert.ok(summary.includes('Reference: ref_stripe_123'))
  assert.ok(summary.includes('Status: Refund issued (Funds returned to original payment card)'))
  assert.ok(summary.includes('Reason: Driver cancelled · 100% deposit refunded'))
  assert.ok(summary.includes('Refund amount: $22.50'))
  assert.ok(summary.includes('Timeline: Refunds are returned to the original payment method'))
})
