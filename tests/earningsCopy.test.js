import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRIVER_SHARE_PERCENT,
  PLATFORM_FEE_PERCENT,
  PAYOUT_STATUS_LABELS,
  PAYOUT_STATUS_BADGE_TONES,
  INCENTIVE_LABELS,
  formatIncentiveName,
  getPayoutStatusLabel,
  getPayoutStatusBadgeTone,
  formatWeeklyEarningsNote,
  formatFareBreakdownExplanation,
  formatWalletBalanceNote,
} from '../packages/rides-native/earningsCopy.js'

test('earnings constants define standard platform split', () => {
  assert.equal(DRIVER_SHARE_PERCENT, 80)
  assert.equal(PLATFORM_FEE_PERCENT, 20)
  assert.equal(DRIVER_SHARE_PERCENT + PLATFORM_FEE_PERCENT, 100)
  assert.ok(Object.isFrozen(PAYOUT_STATUS_LABELS))
  assert.ok(Object.isFrozen(PAYOUT_STATUS_BADGE_TONES))
  assert.ok(Object.isFrozen(INCENTIVE_LABELS))
})

test('formatIncentiveName converts identifiers to readable titles without code syntax', () => {
  assert.equal(formatIncentiveName('driver_carpool_bonus'), 'Carpool bonus')
  assert.equal(formatIncentiveName('student_discount'), 'Student discount')
  assert.equal(formatIncentiveName('game_day_surge'), 'Game Day surge')
  assert.equal(formatIncentiveName('airport_bonus'), 'Airport bonus')

  // Arbitrary custom incentive keys
  assert.equal(formatIncentiveName('night_shift_bonus'), 'Night Shift Bonus')
  assert.equal(formatIncentiveName('weekend-drive'), 'Weekend Drive')

  // Falsy or missing inputs
  assert.equal(formatIncentiveName(null), 'Bonus incentive')
  assert.equal(formatIncentiveName(''), 'Bonus incentive')
  assert.equal(formatIncentiveName(undefined), 'Bonus incentive')
})

test('getPayoutStatusLabel provides friendly status copy', () => {
  assert.equal(getPayoutStatusLabel('pending'), 'Pending transfer')
  assert.equal(getPayoutStatusLabel('processing'), 'Processing transfer')
  assert.equal(getPayoutStatusLabel('paid'), 'Paid out')
  assert.equal(getPayoutStatusLabel('failed'), 'Transfer failed (retry scheduled)')
  assert.equal(getPayoutStatusLabel('canceled'), 'Transfer canceled')

  // Case insensitivity & fallback
  assert.equal(getPayoutStatusLabel('PAID'), 'Paid out')
  assert.equal(getPayoutStatusLabel('queued'), 'Queued')
  assert.equal(getPayoutStatusLabel(null), 'Pending')
})

test('getPayoutStatusBadgeTone maps statuses to consistent UI color tokens', () => {
  assert.equal(getPayoutStatusBadgeTone('pending'), 'orange')
  assert.equal(getPayoutStatusBadgeTone('processing'), 'orange')
  assert.equal(getPayoutStatusBadgeTone('paid'), 'green')
  assert.equal(getPayoutStatusBadgeTone('failed'), 'danger')
  assert.equal(getPayoutStatusBadgeTone('canceled'), 'neutral')
  assert.equal(getPayoutStatusBadgeTone('unknown'), 'neutral')
})

test('formatWeeklyEarningsNote provides clean copy without database column names', () => {
  const emptyNote = formatWeeklyEarningsNote({ weekNetCents: 0 })
  assert.ok(emptyNote.includes('80%'))
  assert.ok(!emptyNote.includes('metadata.'))
  assert.ok(!emptyNote.includes('driver_carpool_bonus'))

  const carpoolNote = formatWeeklyEarningsNote({ weekNetCents: 4500, hasCarpoolBonus: true })
  assert.ok(carpoolNote.includes('carpool payouts'))
  assert.ok(!carpoolNote.includes('metadata.'))
  assert.ok(!carpoolNote.includes('driver_payout_cents'))
  assert.ok(!carpoolNote.includes('driver_carpool_bonus'))

  const standardNote = formatWeeklyEarningsNote({ weekNetCents: 5000, hasCarpoolBonus: false })
  assert.ok(standardNote.includes('80% you keep'))
})

test('formatFareBreakdownExplanation provides clean copy for fare breakdown card', () => {
  const std = formatFareBreakdownExplanation({ standard: true })
  assert.ok(std.includes('80%'))
  assert.ok(std.includes('standard split'))

  const bonus = formatFareBreakdownExplanation({ standard: false, hasCarpoolBonus: true })
  assert.ok(bonus.includes('80% of the fare'))
  assert.ok(bonus.includes('carpools'))
  assert.ok(!bonus.includes('metadata.'))
  assert.ok(!bonus.includes('driver_carpool_bonus'))

  const regular = formatFareBreakdownExplanation({ standard: false, hasCarpoolBonus: false })
  assert.ok(regular.includes('80% of the fare'))
})

test('formatWalletBalanceNote explains transfer lifecycle and retries', () => {
  const nextIso = '2026-10-02T14:30:00.000Z'
  const retryNote = formatWalletBalanceNote({ pendingCents: 2000, nextRetryAt: nextIso })
  assert.ok(retryNote.includes('Next payout retry scheduled'))

  const pendingNote = formatWalletBalanceNote({ pendingCents: 2000, nextRetryAt: null })
  assert.ok(pendingNote.includes('pays out automatically'))

  const zeroNote = formatWalletBalanceNote({ pendingCents: 0, nextRetryAt: null })
  assert.ok(zeroNote.includes('Nothing is waiting to pay out'))
})
