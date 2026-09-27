import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOLD_EXPIRED_LABEL,
  HOLD_LAST_MINUTE_LABEL,
  UNPAID_AIRPORT_HOLD_TTL_MS,
} from './holdExpiry.js'
import {
  HOLD_COUNTDOWN_TICK_MS,
  REQUEST_AGAIN_LABEL,
  SURFACE_TTL_CANCEL_MS,
  holdAirportCode,
  holdExpiryPresentation,
  isOpenUnpaidAirportHold,
  isUnpaidHoldTtlCancel,
  shouldSurfaceHold,
  unpaidHoldCancelReason,
} from './holdExpiryNotice.js'

const START = '2026-09-25T12:00:00.000Z'
const START_MS = Date.parse(START)

function createAirportTrip(overrides = {}) {
  const { metadata, ...rest } = overrides
  return {
    status: 'searching',
    created_at: START,
    deposit_cents: 2500,
    ...rest,
    metadata: {
      kind: 'airport',
      airport: 'GSP',
      ...(metadata || {}),
    },
  }
}

// ============================================================================
// 1. Exported Constants
// ============================================================================

test('exported constants match UI cadence and hold contract specifications', () => {
  assert.equal(typeof HOLD_COUNTDOWN_TICK_MS, 'number')
  assert.equal(HOLD_COUNTDOWN_TICK_MS, 30_000)

  assert.equal(typeof REQUEST_AGAIN_LABEL, 'string')
  assert.equal(REQUEST_AGAIN_LABEL, 'Request again')

  assert.equal(typeof SURFACE_TTL_CANCEL_MS, 'number')
  assert.equal(SURFACE_TTL_CANCEL_MS, 12 * 60 * 60 * 1000)
  assert.equal(SURFACE_TTL_CANCEL_MS, 43_200_000)
})

// ============================================================================
// 2. unpaidHoldCancelReason
// ============================================================================

test('unpaidHoldCancelReason: happy path returns reason from checkout_abandoned metadata', () => {
  const trip = {
    metadata: {
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
        at: START,
      },
    },
  }
  assert.equal(unpaidHoldCancelReason(trip), 'unpaid_hold_ttl')

  const otherReasonTrip = {
    metadata: {
      checkout_abandoned: {
        reason: 'abandoned_by_rider',
      },
    },
  }
  assert.equal(unpaidHoldCancelReason(otherReasonTrip), 'abandoned_by_rider')
})

test('unpaidHoldCancelReason: empty, null, undefined, and non-object trip/metadata', () => {
  assert.equal(unpaidHoldCancelReason(null), '')
  assert.equal(unpaidHoldCancelReason(undefined), '')
  assert.equal(unpaidHoldCancelReason({}), '')
  assert.equal(unpaidHoldCancelReason({ metadata: null }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: undefined }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: {} }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: { checkout_abandoned: null } }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: { checkout_abandoned: undefined } }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: { checkout_abandoned: {} } }), '')

  // Primitive trips
  assert.equal(unpaidHoldCancelReason('string'), '')
  assert.equal(unpaidHoldCancelReason(123), '')
  assert.equal(unpaidHoldCancelReason(true), '')
  assert.equal(unpaidHoldCancelReason(false), '')
  assert.equal(unpaidHoldCancelReason(0), '')
  assert.equal(unpaidHoldCancelReason(Symbol('trip')), '')

  // Primitive or array metadata
  assert.equal(unpaidHoldCancelReason({ metadata: 'string-meta' }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: 42 }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: true }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: [] }), '')
  assert.equal(unpaidHoldCancelReason({ metadata: Object.create(null) }), '')
})

test('unpaidHoldCancelReason: edge strings and non-string reasons', () => {
  // Empty string
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: '' } } }),
    '',
  )

  // Whitespace-only string preserved
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: '   ' } } }),
    '   ',
  )
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: '\t\n' } } }),
    '\t\n',
  )

  // Non-string reasons safely fall back to ''
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: 123 } } }),
    '',
  )
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: true } } }),
    '',
  )
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: null } } }),
    '',
  )
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: ['unpaid_hold_ttl'] } } }),
    '',
  )
  assert.equal(
    unpaidHoldCancelReason({ metadata: { checkout_abandoned: { reason: { code: 'ttl' } } } }),
    '',
  )
})

// ============================================================================
// 3. isUnpaidHoldTtlCancel
// ============================================================================

test('isUnpaidHoldTtlCancel: happy path recognizes canceled and cancelled with unpaid_hold_ttl', () => {
  const singleL = {
    status: 'canceled',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
  }
  assert.equal(isUnpaidHoldTtlCancel(singleL), true)

  const doubleL = {
    status: 'cancelled',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
  }
  assert.equal(isUnpaidHoldTtlCancel(doubleL), true)

  // Case-insensitivity on status
  assert.equal(
    isUnpaidHoldTtlCancel({
      status: 'Canceled',
      metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
    }),
    true,
  )
  assert.equal(
    isUnpaidHoldTtlCancel({
      status: 'CANCELLED',
      metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
    }),
    true,
  )
  assert.equal(
    isUnpaidHoldTtlCancel({
      status: 'CaNcElEd',
      metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
    }),
    true,
  )
})

test('isUnpaidHoldTtlCancel: rejects non-canceled statuses even with unpaid_hold_ttl reason', () => {
  const nonCanceledStatuses = [
    'searching',
    'offered',
    'scheduled',
    'accepted',
    'arriving',
    'arrived',
    'in_progress',
    'completed',
    'expired',
    'requested',
    'cancelled_wait',
  ]

  for (const status of nonCanceledStatuses) {
    const trip = {
      status,
      metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
    }
    assert.equal(isUnpaidHoldTtlCancel(trip), false, `expected false for status: ${status}`)
  }
})

test('isUnpaidHoldTtlCancel: rejects canceled status when reason is different, missing, or edge string', () => {
  const otherReasons = [
    'rider_canceled',
    'driver_declined',
    'unpaid_checkout',
    'card_declined',
    'timeout',
    '',
    '   ',
    null,
    undefined,
  ]

  for (const reason of otherReasons) {
    const trip = {
      status: 'canceled',
      metadata: { checkout_abandoned: { reason } },
    }
    assert.equal(isUnpaidHoldTtlCancel(trip), false)
  }

  // BUG?: reason comparison is strict === 'unpaid_hold_ttl', so uppercase or padded reasons are rejected
  assert.equal(
    isUnpaidHoldTtlCancel({
      status: 'canceled',
      metadata: { checkout_abandoned: { reason: 'UNPAID_HOLD_TTL' } },
    }),
    false,
  )
  assert.equal(
    isUnpaidHoldTtlCancel({
      status: 'canceled',
      metadata: { checkout_abandoned: { reason: ' unpaid_hold_ttl ' } },
    }),
    false,
  )

  // Status with untrimmed whitespace fails String.toLowerCase() match against 'canceled'/'cancelled'
  assert.equal(
    isUnpaidHoldTtlCancel({
      status: ' canceled ',
      metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
    }),
    false,
  )
})

test('isUnpaidHoldTtlCancel: empty, null, undefined, and non-object trip inputs', () => {
  assert.equal(isUnpaidHoldTtlCancel(null), false)
  assert.equal(isUnpaidHoldTtlCancel(undefined), false)
  assert.equal(isUnpaidHoldTtlCancel({}), false)
  assert.equal(isUnpaidHoldTtlCancel('canceled'), false)
  assert.equal(isUnpaidHoldTtlCancel(123), false)
  assert.equal(isUnpaidHoldTtlCancel(true), false)
  assert.equal(isUnpaidHoldTtlCancel(false), false)
  assert.equal(isUnpaidHoldTtlCancel([]), false)
})

// ============================================================================
// 4. isOpenUnpaidAirportHold
// ============================================================================

test('isOpenUnpaidAirportHold: happy path recognizes searching, offered, and scheduled with unpaid deposit', () => {
  for (const status of ['searching', 'offered', 'scheduled']) {
    const trip = createAirportTrip({ status })
    assert.equal(isOpenUnpaidAirportHold(trip), true, `expected true for status: ${status}`)
  }

  // Airport markers: airport code, kind, purpose, or rider_note
  assert.equal(
    isOpenUnpaidAirportHold(createAirportTrip({ metadata: { airport: 'CLT' } })),
    true,
  )
  assert.equal(
    isOpenUnpaidAirportHold(createAirportTrip({ metadata: { kind: 'airport' } })),
    true,
  )
  assert.equal(
    isOpenUnpaidAirportHold(createAirportTrip({ metadata: { purpose: 'airport' } })),
    true,
  )
  assert.equal(
    isOpenUnpaidAirportHold(createAirportTrip({ rider_note: 'airport', metadata: {} })),
    true,
  )

  // Deposit sources: row deposit_cents or metadata depositCents
  assert.equal(
    isOpenUnpaidAirportHold(createAirportTrip({ deposit_cents: 2500 })),
    true,
  )
  assert.equal(
    isOpenUnpaidAirportHold(
      createAirportTrip({ deposit_cents: null, metadata: { airport: 'GSP', depositCents: 2500 } }),
    ),
    true,
  )
})

test('isOpenUnpaidAirportHold: rejects non-open statuses', () => {
  const nonOpenStatuses = [
    'accepted',
    'arriving',
    'arrived',
    'in_progress',
    'completed',
    'canceled',
    'cancelled',
    'requested',
  ]

  for (const status of nonOpenStatuses) {
    const trip = createAirportTrip({ status })
    assert.equal(isOpenUnpaidAirportHold(trip), false, `expected false for status: ${status}`)
  }

  // Case-insensitivity on status (matching isUnpaidHoldTtlCancel)
  assert.equal(isOpenUnpaidAirportHold(createAirportTrip({ status: 'Searching' })), true)
  assert.equal(isOpenUnpaidAirportHold(createAirportTrip({ status: 'SEARCHING' })), true)
  assert.equal(isOpenUnpaidAirportHold(createAirportTrip({ status: 'Scheduled' })), true)
  assert.equal(isOpenUnpaidAirportHold(createAirportTrip({ status: 'Offered' })), true)
  assert.equal(isOpenUnpaidAirportHold(createAirportTrip({ status: ' searching ' })), false)
})

test('isOpenUnpaidAirportHold: rejects paid trips, non-airport trips, and $0 deposit', () => {
  // Deposit already paid via checkout_deposit
  const paidWithCheckoutDeposit = createAirportTrip({
    metadata: {
      airport: 'GSP',
      checkout_deposit: { session_id: 'cs_test_123' },
    },
  })
  assert.equal(isOpenUnpaidAirportHold(paidWithCheckoutDeposit), false)

  // Deposit already paid via fare_paid_cents >= deposit_cents
  const paidWithFarePaidCents = createAirportTrip({
    deposit_cents: 2500,
    metadata: {
      airport: 'GSP',
      fare_paid_cents: 2500,
    },
  })
  assert.equal(isOpenUnpaidAirportHold(paidWithFarePaidCents), false)

  const overpaid = createAirportTrip({
    deposit_cents: 2500,
    metadata: {
      airport: 'GSP',
      fare_paid_cents: 3000,
    },
  })
  assert.equal(isOpenUnpaidAirportHold(overpaid), false)

  // Partial pay is still unpaid
  const partialPaid = createAirportTrip({
    deposit_cents: 2500,
    metadata: {
      airport: 'GSP',
      fare_paid_cents: 2499,
    },
  })
  assert.equal(isOpenUnpaidAirportHold(partialPaid), true)

  // Non-airport purpose without airport metadata or airport note
  const campusTrip = {
    status: 'searching',
    deposit_cents: 2500,
    metadata: { purpose: 'campus' },
  }
  assert.equal(isOpenUnpaidAirportHold(campusTrip), false)

  // Zero or missing deposit cents
  const zeroDeposit = createAirportTrip({ deposit_cents: 0 })
  assert.equal(isOpenUnpaidAirportHold(zeroDeposit), false)

  const missingDeposit = createAirportTrip({ deposit_cents: null, metadata: { airport: 'GSP' } })
  assert.equal(isOpenUnpaidAirportHold(missingDeposit), false)
})

test('isOpenUnpaidAirportHold: empty, null, undefined, and primitive trip inputs', () => {
  assert.equal(isOpenUnpaidAirportHold(null), false)
  assert.equal(isOpenUnpaidAirportHold(undefined), false)
  assert.equal(isOpenUnpaidAirportHold({}), false)
  assert.equal(isOpenUnpaidAirportHold('searching'), false)
  assert.equal(isOpenUnpaidAirportHold(123), false)
  assert.equal(isOpenUnpaidAirportHold(true), false)
  assert.equal(isOpenUnpaidAirportHold(false), false)
})

// ============================================================================
// 5. shouldSurfaceHold
// ============================================================================

test('shouldSurfaceHold: open unpaid airport holds always surface regardless of clock', () => {
  const openHold = createAirportTrip({ status: 'searching' })

  assert.equal(shouldSurfaceHold(openHold), true)
  assert.equal(shouldSurfaceHold(openHold, START_MS), true)
  assert.equal(shouldSurfaceHold(openHold, START_MS + 100 * 24 * 60 * 60 * 1000), true)
  assert.equal(shouldSurfaceHold(openHold, 0), true)
  assert.equal(shouldSurfaceHold(openHold, -1000), true)
  assert.equal(shouldSurfaceHold(openHold, null), true)
})

test('shouldSurfaceHold: non-open, non-TTL-cancel trips do not surface', () => {
  assert.equal(shouldSurfaceHold(null), false)
  assert.equal(shouldSurfaceHold(undefined), false)
  assert.equal(shouldSurfaceHold({}), false)
  assert.equal(shouldSurfaceHold({ status: 'accepted' }), false)
  assert.equal(shouldSurfaceHold({ status: 'completed' }), false)

  // Normal cancellation (rider canceled, not unpaid_hold_ttl)
  const riderCanceled = {
    status: 'canceled',
    canceled_at: START,
    metadata: { checkout_abandoned: { reason: 'rider_canceled', at: START } },
  }
  assert.equal(shouldSurfaceHold(riderCanceled, START_MS + 1000), false)
})

test('shouldSurfaceHold: TTL cancel surfaces within 12 hours and hides after 12 hours', () => {
  const ttlCanceled = {
    status: 'canceled',
    metadata: {
      airport: 'GSP',
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
        at: START,
      },
    },
  }

  // Exact cancellation time
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS), true)

  // Within 12-hour window
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS + 60 * 60 * 1000), true)
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS + 11 * 60 * 60 * 1000), true)
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS + SURFACE_TTL_CANCEL_MS - 1), true)

  // Exact 12-hour boundary: clock - ms < SURFACE_TTL_CANCEL_MS is false when equal
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS + SURFACE_TTL_CANCEL_MS), false)

  // Past 12-hour window
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS + SURFACE_TTL_CANCEL_MS + 1), false)
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS + 24 * 60 * 60 * 1000), false)

  // Clock skew: clock before cancel time
  assert.equal(shouldSurfaceHold(ttlCanceled, START_MS - 5000), true)
})

test('shouldSurfaceHold: timestamp fallback order (checkout_abandoned.at -> canceled_at -> created_at)', () => {
  const tAbandoned = '2026-09-25T12:00:00.000Z'
  const tCanceled = '2026-09-25T13:00:00.000Z'
  const tCreated = '2026-09-25T11:00:00.000Z'

  // 1. checkout_abandoned.at takes precedence over canceled_at and created_at
  const tripAllThree = {
    status: 'canceled',
    created_at: tCreated,
    canceled_at: tCanceled,
    metadata: {
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
        at: tAbandoned,
      },
    },
  }
  // At tAbandoned + 12h: false (using tAbandoned)
  assert.equal(shouldSurfaceHold(tripAllThree, Date.parse(tAbandoned) + SURFACE_TTL_CANCEL_MS), false)
  // At tAbandoned + 11h: true
  assert.equal(shouldSurfaceHold(tripAllThree, Date.parse(tAbandoned) + 11 * 3600 * 1000), true)

  // 2. canceled_at used when checkout_abandoned.at is missing
  const tripNoAbandonedAt = {
    status: 'canceled',
    created_at: tCreated,
    canceled_at: tCanceled,
    metadata: {
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
      },
    },
  }
  // At tCanceled + 11h: true
  assert.equal(shouldSurfaceHold(tripNoAbandonedAt, Date.parse(tCanceled) + 11 * 3600 * 1000), true)
  // At tCanceled + 12h: false
  assert.equal(shouldSurfaceHold(tripNoAbandonedAt, Date.parse(tCanceled) + SURFACE_TTL_CANCEL_MS), false)

  // 3. created_at used when checkout_abandoned.at and canceled_at are missing
  const tripCreatedOnly = {
    status: 'canceled',
    created_at: tCreated,
    metadata: {
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
      },
    },
  }
  assert.equal(shouldSurfaceHold(tripCreatedOnly, Date.parse(tCreated) + 11 * 3600 * 1000), true)
  assert.equal(shouldSurfaceHold(tripCreatedOnly, Date.parse(tCreated) + SURFACE_TTL_CANCEL_MS), false)
})

test('shouldSurfaceHold: missing or non-finite timestamp defaults to surfacing (returns true)', () => {
  // No timestamps at all
  const noDates = {
    status: 'canceled',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
  }
  assert.equal(shouldSurfaceHold(noDates, START_MS + 24 * 60 * 60 * 1000), true)

  // Unparseable string timestamp
  const invalidDate = {
    status: 'canceled',
    canceled_at: 'not-a-valid-date',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
  }
  assert.equal(shouldSurfaceHold(invalidDate, START_MS + 24 * 60 * 60 * 1000), true)

  // Empty string timestamp
  const emptyDate = {
    status: 'canceled',
    canceled_at: '',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl', at: '' } },
  }
  assert.equal(shouldSurfaceHold(emptyDate, START_MS + 24 * 60 * 60 * 1000), true)

  // BUG?: shouldSurfaceHold requires at to be a string; numeric epoch timestamps are treated as NaN and default to returning true
  const numericDate = {
    status: 'canceled',
    canceled_at: START_MS,
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl', at: START_MS } },
  }
  assert.equal(shouldSurfaceHold(numericDate, START_MS + 48 * 60 * 60 * 1000), true)
})

test('shouldSurfaceHold: now parameter handling with non-finite and non-numeric values', () => {
  const recentCancel = {
    status: 'canceled',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl', at: new Date().toISOString() } },
  }
  // Default now (omitted) uses Date.now()
  assert.equal(shouldSurfaceHold(recentCancel), true)

  // Non-finite numbers fall back to Date.now()
  assert.equal(shouldSurfaceHold(recentCancel, Number.NaN), true)
  assert.equal(shouldSurfaceHold(recentCancel, Number.POSITIVE_INFINITY), true)
  assert.equal(shouldSurfaceHold(recentCancel, null), true)
  assert.equal(shouldSurfaceHold(recentCancel, undefined), true)

  // BUG?: shouldSurfaceHold only accepts numeric timestamps for now, unlike holdRemaining which accepts Date objects and ISO strings
  const oldCancel = {
    status: 'canceled',
    metadata: {
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
        at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    },
  }
  // When passed a Date object for now, it falls back to Date.now() (which is > 12h after oldCancel, so false)
  assert.equal(shouldSurfaceHold(oldCancel, new Date()), false)
})

// ============================================================================
// 6. holdAirportCode
// ============================================================================

test('holdAirportCode: happy path extracts GSP and CLT codes', () => {
  assert.equal(holdAirportCode({ metadata: { airport: 'GSP' } }), 'GSP')
  assert.equal(holdAirportCode({ metadata: { airport: 'CLT' } }), 'CLT')
})

test('holdAirportCode: returns null for other airport codes or non-target strings', () => {
  assert.equal(holdAirportCode({ metadata: { airport: 'ATL' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: 'ORD' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: 'JFK' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: 'GSP Airport' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: 'GSP/CLT' } }), null)
})

test('holdAirportCode: edge strings and case sensitivity', () => {
  // BUG?: holdAirportCode does not normalize lowercase airport codes ('gsp' returns null)
  assert.equal(holdAirportCode({ metadata: { airport: 'gsp' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: 'clt' } }), null)

  // Whitespace-padded codes
  assert.equal(holdAirportCode({ metadata: { airport: ' GSP ' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: ' CLT ' } }), null)

  // Blank strings
  assert.equal(holdAirportCode({ metadata: { airport: '' } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: '   ' } }), null)
})

test('holdAirportCode: empty, null, undefined, and non-object trip/metadata', () => {
  assert.equal(holdAirportCode(null), null)
  assert.equal(holdAirportCode(undefined), null)
  assert.equal(holdAirportCode({}), null)
  assert.equal(holdAirportCode({ metadata: null }), null)
  assert.equal(holdAirportCode({ metadata: undefined }), null)
  assert.equal(holdAirportCode({ metadata: {} }), null)
  assert.equal(holdAirportCode({ metadata: { airport: null } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: undefined } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: 123 } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: true } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: ['GSP'] } }), null)
  assert.equal(holdAirportCode({ metadata: { airport: { code: 'GSP' } } }), null)

  // Primitive trips
  assert.equal(holdAirportCode('GSP'), null)
  assert.equal(holdAirportCode(123), null)
  assert.equal(holdAirportCode(true), null)
})

// ============================================================================
// 7. holdExpiryPresentation
// ============================================================================

test('holdExpiryPresentation: TTL canceled trip immediately returns expired with requestAgain: true', () => {
  const canceled = {
    status: 'canceled',
    created_at: START,
    metadata: {
      airport: 'GSP',
      checkout_abandoned: {
        reason: 'unpaid_hold_ttl',
        at: START,
      },
    },
  }

  // Returns expired even if the clock has not passed the 20-minute mark
  const withinHoldClock = holdExpiryPresentation(canceled, START_MS + 60_000)
  assert.deepEqual(withinHoldClock, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })

  // Also expired after the 20-minute mark
  const afterHoldClock = holdExpiryPresentation(canceled, START_MS + 25 * 60 * 1000)
  assert.deepEqual(afterHoldClock, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })

  // Works with British spelling 'cancelled'
  const britishCanceled = {
    status: 'cancelled',
    metadata: { checkout_abandoned: { reason: 'unpaid_hold_ttl' } },
  }
  assert.deepEqual(holdExpiryPresentation(britishCanceled, START_MS), {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })
})

test('holdExpiryPresentation: non-open and non-TTL-cancel trips return hidden', () => {
  const hiddenResult = { mode: 'hidden', label: '', requestAgain: false }

  // Null, undefined, empty
  assert.deepEqual(holdExpiryPresentation(null, START_MS), hiddenResult)
  assert.deepEqual(holdExpiryPresentation(undefined, START_MS), hiddenResult)
  assert.deepEqual(holdExpiryPresentation({}, START_MS), hiddenResult)
  assert.deepEqual(holdExpiryPresentation('searching', START_MS), hiddenResult)

  // Non-open statuses
  assert.deepEqual(holdExpiryPresentation(createAirportTrip({ status: 'accepted' }), START_MS), hiddenResult)
  assert.deepEqual(holdExpiryPresentation(createAirportTrip({ status: 'arriving' }), START_MS), hiddenResult)
  assert.deepEqual(holdExpiryPresentation(createAirportTrip({ status: 'in_progress' }), START_MS), hiddenResult)
  assert.deepEqual(holdExpiryPresentation(createAirportTrip({ status: 'completed' }), START_MS), hiddenResult)

  // Canceled without unpaid_hold_ttl reason
  const riderCanceled = {
    status: 'canceled',
    metadata: { checkout_abandoned: { reason: 'rider_canceled' } },
  }
  assert.deepEqual(holdExpiryPresentation(riderCanceled, START_MS), hiddenResult)

  // Non-airport trips
  const campusTrip = {
    status: 'searching',
    deposit_cents: 2500,
    created_at: START,
    metadata: { purpose: 'campus' },
  }
  assert.deepEqual(holdExpiryPresentation(campusTrip, START_MS), hiddenResult)

  // Paid airport trips
  const paidTrip = createAirportTrip({
    status: 'searching',
    metadata: {
      airport: 'GSP',
      checkout_deposit: { session_id: 'cs_123' },
    },
  })
  assert.deepEqual(holdExpiryPresentation(paidTrip, START_MS), hiddenResult)
})

test('holdExpiryPresentation: open unpaid hold with missing or invalid start dates returns hidden', () => {
  const hiddenResult = { mode: 'hidden', label: '', requestAgain: false }

  // Missing created_at and stripe_checkout_created_at
  const noDates = createAirportTrip({
    status: 'searching',
    created_at: undefined,
    metadata: { airport: 'GSP' },
  })
  assert.deepEqual(holdExpiryPresentation(noDates, START_MS), hiddenResult)

  // Unparseable created_at
  const badDate = createAirportTrip({
    status: 'searching',
    created_at: 'invalid-date',
    metadata: { airport: 'GSP' },
  })
  assert.deepEqual(holdExpiryPresentation(badDate, START_MS), hiddenResult)
})

test('holdExpiryPresentation: open unpaid hold counting down (> 1 minute)', () => {
  const trip = createAirportTrip({ status: 'searching' })

  // 12 minutes remaining
  const at12 = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS - 12 * 60 * 1000)
  assert.deepEqual(at12, {
    mode: 'countdown',
    label: 'Pay within 12 min to keep your ride',
    requestAgain: false,
  })

  // 1 minute remaining (exact minute boundary)
  const at1 = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS - 60_000)
  assert.deepEqual(at1, {
    mode: 'countdown',
    label: 'Pay within 1 min to keep your ride',
    requestAgain: false,
  })

  // Whole minutes floored (12 min 59 sec remaining renders as 12 min)
  const floored = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS - (12 * 60 * 1000 + 59_000))
  assert.deepEqual(floored, {
    mode: 'countdown',
    label: 'Pay within 12 min to keep your ride',
    requestAgain: false,
  })
})

test('holdExpiryPresentation: open unpaid hold in last minute (< 60 seconds)', () => {
  const trip = createAirportTrip({ status: 'searching' })

  // 59,999 ms left
  const at59s = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS - 59_999)
  assert.deepEqual(at59s, {
    mode: 'countdown',
    label: HOLD_LAST_MINUTE_LABEL,
    requestAgain: false,
  })

  // 1 ms left
  const at1ms = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS - 1)
  assert.deepEqual(at1ms, {
    mode: 'countdown',
    label: HOLD_LAST_MINUTE_LABEL,
    requestAgain: false,
  })
})

test('holdExpiryPresentation: open unpaid hold expired by clock (msLeft <= 0)', () => {
  const trip = createAirportTrip({ status: 'offered' })

  // Exactly at deadline (msLeft = 0)
  const exactDeadline = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS)
  assert.deepEqual(exactDeadline, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })

  // 1 ms past deadline (msLeft = -1)
  const pastDeadline = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS + 1)
  assert.deepEqual(pastDeadline, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })

  // 10 minutes past deadline
  const longPast = holdExpiryPresentation(trip, START_MS + UNPAID_AIRPORT_HOLD_TTL_MS + 10 * 60 * 1000)
  assert.deepEqual(longPast, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })
})

test('holdExpiryPresentation: anchors hold at later of created_at and stripe_checkout_created_at', () => {
  // Session created 10 minutes after trip created
  const sessionTime = '2026-09-25T12:10:00.000Z'
  const sessionMs = Date.parse(sessionTime)
  const scheduledTrip = createAirportTrip({
    status: 'scheduled',
    created_at: START,
    metadata: {
      airport: 'CLT',
      stripe_checkout_created_at: sessionTime,
    },
  })

  // At 12:25: from START (12:00) this would be 25 min (expired),
  // but from sessionMs (12:10) it is 15 min (5 minutes remaining)
  const at1225 = holdExpiryPresentation(scheduledTrip, START_MS + 25 * 60 * 1000)
  assert.deepEqual(at1225, {
    mode: 'countdown',
    label: 'Pay within 5 min to keep your ride',
    requestAgain: false,
  })

  // Deadline anchored at sessionMs + TTL
  const expiredAtSessionDeadline = holdExpiryPresentation(scheduledTrip, sessionMs + UNPAID_AIRPORT_HOLD_TTL_MS)
  assert.deepEqual(expiredAtSessionDeadline, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })
})

test('holdExpiryPresentation: now accepts Date objects and ISO strings via holdRemaining', () => {
  const trip = createAirportTrip({ status: 'searching' })
  const targetTimeMs = START_MS + UNPAID_AIRPORT_HOLD_TTL_MS - 8 * 60 * 1000

  // Date object
  const fromDate = holdExpiryPresentation(trip, new Date(targetTimeMs))
  assert.deepEqual(fromDate, {
    mode: 'countdown',
    label: 'Pay within 8 min to keep your ride',
    requestAgain: false,
  })

  // ISO string
  const fromIso = holdExpiryPresentation(trip, new Date(targetTimeMs).toISOString())
  assert.deepEqual(fromIso, {
    mode: 'countdown',
    label: 'Pay within 8 min to keep your ride',
    requestAgain: false,
  })
})

test('holdExpiryPresentation: default now uses Date.now()', () => {
  // Fresh trip created right now counts down
  const freshTrip = createAirportTrip({
    status: 'searching',
    created_at: new Date().toISOString(),
  })
  const view = holdExpiryPresentation(freshTrip)
  assert.equal(view.mode, 'countdown')
  assert.equal(view.requestAgain, false)
  assert.match(view.label, /^Pay within \d+ min to keep your ride$/)

  // Old trip created 1 hour ago is expired
  const ancientTrip = createAirportTrip({
    status: 'searching',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  })
  const ancientView = holdExpiryPresentation(ancientTrip)
  assert.deepEqual(ancientView, {
    mode: 'expired',
    label: HOLD_EXPIRED_LABEL,
    requestAgain: true,
  })
})
