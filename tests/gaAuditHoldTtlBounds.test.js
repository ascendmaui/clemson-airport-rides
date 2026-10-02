import assert from 'node:assert/strict'
import test from 'node:test'
import {
  airportHoldAnchorMs,
  decideUnpaidAirportHoldTtl,
  releaseExpiredUnpaidAirportHold,
  releaseExpiredUnpaidAirportHolds,
  UNPAID_AIRPORT_HOLD_TTL_MS,
  UNPAID_CHECKOUT_STATUSES,
} from '../server/abandonedCheckout.js'

test('GA91: decideUnpaidAirportHoldTtl sanitizes invalid or negative ttlMs to standard UNPAID_AIRPORT_HOLD_TTL_MS', () => {
  const baseTime = Date.parse('2026-10-02T04:00:00Z')
  const trip = {
    id: 'trip-hold-1',
    status: 'searching',
    deposit_cents: 2500,
    created_at: new Date(baseTime).toISOString(),
    metadata: { kind: 'airport', purpose: 'airport' },
  }

  // 10 minutes elapsed (less than 20 min TTL)
  const tenMinLater = baseTime + 10 * 60 * 1000

  // Passing NaN, negative, or zero ttlMs must NOT prematurely cancel the hold!
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip, payments: [], now: tenMinLater, ttlMs: NaN }).action,
    'skip',
    'NaN ttlMs falls back to standard 20m TTL, keeping hold safe at 10m',
  )
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip, payments: [], now: tenMinLater, ttlMs: -5000 }).action,
    'skip',
    'Negative ttlMs falls back to standard 20m TTL',
  )
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip, payments: [], now: tenMinLater, ttlMs: 0 }).action,
    'skip',
    'Zero ttlMs falls back to standard 20m TTL',
  )
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip, payments: [], now: tenMinLater, ttlMs: 'invalid' }).action,
    'skip',
    'Malformed string ttlMs falls back to standard 20m TTL',
  )

  // Valid numeric string should be accepted
  const fiveMinTtl = 5 * 60 * 1000
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip, payments: [], now: tenMinLater, ttlMs: String(fiveMinTtl) }).action,
    'cancel',
    'Numeric string ttlMs is parsed properly',
  )

  // At 21 minutes, standard TTL expires
  const twentyOneMinLater = baseTime + 21 * 60 * 1000
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip, payments: [], now: twentyOneMinLater, ttlMs: NaN }).action,
    'cancel',
    'Expired when past standard TTL',
  )
})

test('GA91: airportHoldAnchorMs handles Date instances, microsecond ISO strings, and array metadata safely', () => {
  const t1 = Date.parse('2026-10-02T04:10:00.123456Z')
  const t2 = Date.parse('2026-10-02T04:15:00.789Z')

  // Date instance created_at
  const tripDate = {
    created_at: new Date(t1),
    metadata: { stripe_checkout_created_at: new Date(t2).toISOString() },
  }
  assert.equal(airportHoldAnchorMs(tripDate), t2)

  // Array metadata corruption protection
  const tripArrayMeta = {
    created_at: new Date(t1).toISOString(),
    metadata: ['corrupted', 'array'],
  }
  assert.equal(airportHoldAnchorMs(tripArrayMeta), t1)

  // Null / primitive metadata protection
  const tripNullMeta = {
    created_at: new Date(t1).toISOString(),
    metadata: null,
  }
  assert.equal(airportHoldAnchorMs(tripNullMeta), t1)
})

test('GA91: clock drift tolerance keeps hold in pool when anchor is in the future relative to server time', () => {
  const now = Date.parse('2026-10-02T04:00:00Z')
  // Stripe session created with a clock slightly ahead of server
  const futureTrip = {
    id: 'trip-future-1',
    status: 'offered',
    deposit_cents: 2000,
    created_at: new Date(now + 60 * 1000).toISOString(),
    metadata: {
      kind: 'airport',
      purpose: 'airport',
      stripe_checkout_created_at: new Date(now + 120 * 1000).toISOString(),
    },
  }

  const decision = decideUnpaidAirportHoldTtl({ trip: futureTrip, payments: [], now })
  assert.equal(decision.action, 'skip')
  assert.equal(decision.reason, 'within_ttl')
})

test('GA91: assigned driver or non-pool status is never canceled by hold TTL sweep', () => {
  const oldTime = Date.parse('2026-10-02T01:00:00Z')
  const now = Date.parse('2026-10-02T04:00:00Z')

  // Assigned driver
  const assignedTrip = {
    id: 'trip-assigned-1',
    status: 'searching',
    driver_id: 'drv-42',
    deposit_cents: 2500,
    created_at: new Date(oldTime).toISOString(),
    metadata: { kind: 'airport', purpose: 'airport' },
  }
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip: assignedTrip, payments: [], now }).reason,
    'driver_assigned',
  )

  // Terminal or non-pool statuses
  for (const st of ['accepted', 'in_progress', 'completed', 'canceled']) {
    const activeTrip = {
      id: `trip-${st}`,
      status: st,
      deposit_cents: 2500,
      created_at: new Date(oldTime).toISOString(),
      metadata: { kind: 'airport', purpose: 'airport' },
    }
    assert.equal(
      decideUnpaidAirportHoldTtl({ trip: activeTrip, payments: [], now }).action,
      'skip',
      `Status ${st} is skipped from hold TTL cancellation`,
    )
  }
})

test('GA91: paid airport deposits are strictly preserved across isAirportDepositPaid and payments table records', () => {
  const oldTime = Date.parse('2026-10-02T01:00:00Z')
  const now = Date.parse('2026-10-02T04:00:00Z')

  // Stamped fare_paid_cents
  const paidFareTrip = {
    id: 'trip-paid-1',
    status: 'scheduled',
    deposit_cents: 3000,
    created_at: new Date(oldTime).toISOString(),
    metadata: { kind: 'airport', purpose: 'airport', fare_paid_cents: 3000 },
  }
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip: paidFareTrip, payments: [], now }).action,
    'keep',
  )

  // Stamped checkout_deposit
  const stampedTrip = {
    id: 'trip-paid-2',
    status: 'searching',
    deposit_cents: 3000,
    created_at: new Date(oldTime).toISOString(),
    metadata: { kind: 'airport', purpose: 'airport', checkout_deposit: { at: new Date(oldTime).toISOString() } },
  }
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip: stampedTrip, payments: [], now }).action,
    'keep',
  )

  // Payments table deposit record
  const unpaidTrip = {
    id: 'trip-paid-3',
    status: 'searching',
    deposit_cents: 3000,
    created_at: new Date(oldTime).toISOString(),
    metadata: { kind: 'airport', purpose: 'airport' },
  }
  const payments = [{ kind: 'airport_deposit', status: 'succeeded', amount_cents: 3000 }]
  assert.equal(
    decideUnpaidAirportHoldTtl({ trip: unpaidTrip, payments, now }).action,
    'keep',
  )
})

test('GA91: releaseExpiredUnpaidAirportHolds batch limit clamping and dryRun behavior', async () => {
  const fakeSb = {
    from(table) {
      assert.equal(table, 'trips')
      return {
        select() { return this },
        in() { return this },
        is() { return this },
        gt() { return this },
        lte() { return this },
        order() { return this },
        limit(n) {
          assert.ok(n >= 1 && n <= 40, `Batch size ${n} clamped between 1 and 40`)
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  }

  // Clamping tests
  const res1 = await releaseExpiredUnpaidAirportHolds(fakeSb, { limit: 100, dryRun: true })
  assert.equal(res1.ok, true)
  assert.equal(res1.dryRun, true)
  assert.equal(res1.scanned, 0)

  const res2 = await releaseExpiredUnpaidAirportHolds(fakeSb, { limit: -10 })
  assert.equal(res2.ok, true)

  const res3 = await releaseExpiredUnpaidAirportHolds(fakeSb, { limit: '25' })
  assert.equal(res3.ok, true)
})
