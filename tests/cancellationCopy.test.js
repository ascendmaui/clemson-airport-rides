import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANCELLATION_REASONS,
  CANCELLATION_REASON_CODES,
  RIDER_CANCELLATION_OPTIONS,
  DRIVER_CANCELLATION_OPTIONS,
  normalizeCancellationReason,
  extractCancellationReason,
  getCancellationCopy,
} from '../packages/rides-native/cancellationCopy.js'

test('CANCELLATION_REASONS dictionary contains complete metadata for rider, driver, and system reasons', () => {
  assert.ok(CANCELLATION_REASON_CODES.length >= 8)

  const hold = CANCELLATION_REASONS.UNPAID_HOLD_TTL
  assert.equal(hold.code, 'unpaid_hold_ttl')
  assert.equal(hold.initiator, 'system')
  assert.equal(hold.shortLabel, 'Airport hold expired')
  assert.ok(hold.riderExplanation.includes('25% deposit'))

  const noShow = CANCELLATION_REASONS.DRIVER_RIDER_NO_SHOW
  assert.equal(noShow.code, 'driver_rider_no_show')
  assert.equal(noShow.initiator, 'driver')
  assert.equal(noShow.shortLabel, 'Rider no-show')
  assert.ok(noShow.riderExplanation.includes('$5 wait'))

  const autoWait = CANCELLATION_REASONS.WAIT_TIMEOUT_AUTO
  assert.equal(autoWait.code, 'wait_timeout_auto')
  assert.equal(autoWait.initiator, 'system')
  assert.ok(autoWait.riderExplanation.includes('7 minutes'))

  const midride = CANCELLATION_REASONS.RIDER_CANCEL_MIDRIDE
  assert.equal(midride.code, 'rider_cancel_midride')
  assert.equal(midride.initiator, 'rider')
  assert.equal(midride.shortLabel, 'Canceled mid-trip')
})

test('normalizeCancellationReason maps various codes, aliases, and regexes', () => {
  // Direct codes
  assert.equal(normalizeCancellationReason('rider_change_of_plans'), 'rider_change_of_plans')
  assert.equal(normalizeCancellationReason('unpaid_hold_ttl'), 'unpaid_hold_ttl')

  // Aliases
  assert.equal(normalizeCancellationReason('changed_mind'), 'rider_change_of_plans')
  assert.equal(normalizeCancellationReason('hold_expired'), 'unpaid_hold_ttl')
  assert.equal(normalizeCancellationReason('no_show'), 'driver_rider_no_show')
  assert.equal(normalizeCancellationReason('auto'), 'wait_timeout_auto')
  assert.equal(normalizeCancellationReason('cancelled_wait'), 'wait_timeout_auto')
  assert.equal(normalizeCancellationReason('canceled_midride'), 'rider_cancel_midride')

  // Case and whitespace insensitivity
  assert.equal(normalizeCancellationReason('  CHANGE_OF_PLANS  '), 'rider_change_of_plans')
  assert.equal(normalizeCancellationReason('No_Show'), 'driver_rider_no_show')

  // Null & invalid
  assert.equal(normalizeCancellationReason(''), null)
  assert.equal(normalizeCancellationReason(null), null)
  assert.equal(normalizeCancellationReason(undefined), null)
  assert.equal(normalizeCancellationReason('some_random_reason'), null)
})

test('extractCancellationReason finds cancellation reason in trip objects', () => {
  assert.equal(extractCancellationReason(null), null)
  assert.equal(extractCancellationReason({ status: 'completed' }), null)

  // From metadata.checkout_abandoned.reason
  assert.equal(
    extractCancellationReason({ metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } } }),
    'unpaid_hold_ttl'
  )

  // From wait_cancel_reason
  assert.equal(
    extractCancellationReason({ wait_cancel_reason: 'auto' }),
    'auto'
  )

  // From status cancelled_wait
  assert.equal(
    extractCancellationReason({ status: 'cancelled_wait' }),
    'cancelled_wait'
  )

  // From status canceled_midride
  assert.equal(
    extractCancellationReason({ status: 'canceled_midride' }),
    'canceled_midride'
  )

  // From metadata.cancel_reason
  assert.equal(
    extractCancellationReason({ metadata: { cancel_reason: 'rider_change_of_plans' } }),
    'rider_change_of_plans'
  )
})

test('getCancellationCopy returns role-tailored headlines and explanations', () => {
  // Rider view of hold expired
  const riderHold = getCancellationCopy('unpaid_hold_ttl', { role: 'rider' })
  assert.equal(riderHold.code, 'unpaid_hold_ttl')
  assert.equal(riderHold.isHoldExpired, true)
  assert.equal(riderHold.headline, 'Airport hold expired')
  assert.ok(riderHold.explanation.includes('deposit'))

  // Driver view of hold expired
  const driverHold = getCancellationCopy('unpaid_hold_ttl', { role: 'driver' })
  assert.equal(driverHold.headline, 'Unpaid hold expired')

  // Preferred driver declined
  const riderPreferred = getCancellationCopy('preferred_declined', { role: 'rider' })
  assert.equal(riderPreferred.isPreferredDeclined, true)
  assert.equal(riderPreferred.headline, 'Preferred driver unavailable')
  assert.ok(riderPreferred.explanation.includes('declined') || riderPreferred.explanation.includes('not offered'))

  // Auto wait timeout
  const riderAuto = getCancellationCopy('wait_timeout_auto', { role: 'rider' })
  assert.equal(riderAuto.isAutoWaitCancel, true)
  assert.equal(riderAuto.headline, 'Ride auto-canceled at pickup')

  // From trip object directly
  const tripCopy = getCancellationCopy({
    status: 'canceled',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
  }, { role: 'rider' })
  assert.equal(tripCopy.isHoldExpired, true)
  assert.equal(tripCopy.code, 'unpaid_hold_ttl')

  // Fallback for unknown / unmapped reason
  const fallback = getCancellationCopy('unknown_reason', { role: 'rider' })
  assert.equal(fallback.code, 'other')
  assert.equal(fallback.headline, 'Ride canceled')
  assert.equal(fallback.explanation, 'This ride was canceled.')
})

test('RIDER_CANCELLATION_OPTIONS and DRIVER_CANCELLATION_OPTIONS expose user options', () => {
  assert.ok(RIDER_CANCELLATION_OPTIONS.length >= 3)
  for (const opt of RIDER_CANCELLATION_OPTIONS) {
    assert.ok(opt.id)
    assert.ok(opt.label)
    assert.ok(opt.description)
  }

  assert.ok(DRIVER_CANCELLATION_OPTIONS.length >= 2)
  for (const opt of DRIVER_CANCELLATION_OPTIONS) {
    assert.ok(opt.id)
    assert.ok(opt.label)
    assert.ok(opt.description)
  }
})

test('driverStatusDetail integrates with cancellationCopy', async () => {
  const { driverStatusDetail } = await import('../packages/rides-native/tripTags.js')
  assert.equal(driverStatusDetail('canceled'), 'This trip is canceled.')
  assert.equal(
    driverStatusDetail('canceled', { wait_cancel_reason: 'auto' }),
    'The ride automatically canceled after 7 minutes of waiting at pickup. The wait and cancellation fee was charged.'
  )
  assert.equal(
    driverStatusDetail('canceled', { metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } } }),
    'An open scheduled airport hold expired before the deposit was paid.'
  )
})
