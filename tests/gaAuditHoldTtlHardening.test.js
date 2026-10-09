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
import { holdTtlCronAuthorized } from '../server/endpoints/expireUnpaidAirportHolds.js'

test('GA98: releaseExpiredUnpaidAirportHolds handles NaN now and ttlMs without throwing RangeError', async () => {
  let capturedCutoff = null
  const fakeSb = {
    from(table) {
      assert.equal(table, 'trips')
      return {
        select() { return this },
        in() { return this },
        is() { return this },
        gt() { return this },
        lte(col, val) {
          if (col === 'created_at') capturedCutoff = val
          return this
        },
        order() { return this },
        limit() {
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  }

  // Passing NaN now or NaN ttlMs must not throw RangeError: Invalid time value
  const res = await releaseExpiredUnpaidAirportHolds(fakeSb, {
    now: NaN,
    ttlMs: NaN,
  })
  assert.equal(res.ok, true)
  assert.ok(capturedCutoff, 'Cutoff ISO string was calculated safely')
  assert.ok(!Number.isNaN(Date.parse(capturedCutoff)), 'Cutoff is a valid date timestamp')
})

test('GA98: decideUnpaidAirportHoldTtl sanitizes invalid or negative ttlMs to standard UNPAID_AIRPORT_HOLD_TTL_MS', () => {
  const baseTime = Date.parse('2026-10-07T12:00:00Z')
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

test('GA98: airportHoldAnchorMs handles Date instances, microsecond ISO strings, and array metadata safely', () => {
  const t1 = Date.parse('2026-10-07T12:10:00.123456Z')
  const t2 = Date.parse('2026-10-07T12:15:00.789Z')

  // Date instance created_at
  const tripDate = {
    created_at: new Date(t1),
    metadata: { stripe_checkout_created_at: new Date(t2).toISOString() },
  }
  assert.equal(airportHoldAnchorMs(tripDate), t2)

  // Date instance in stripe_checkout_created_at
  const tripDateMeta = {
    created_at: new Date(t1).toISOString(),
    metadata: { stripe_checkout_created_at: new Date(t2) },
  }
  assert.equal(airportHoldAnchorMs(tripDateMeta), t2)

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

test('GA98: clock drift tolerance keeps hold in pool when anchor is in the future relative to server time', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
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

test('GA98: assigned driver or non-pool status is never canceled by hold TTL sweep', () => {
  const oldTime = Date.parse('2026-10-07T08:00:00Z')
  const now = Date.parse('2026-10-07T12:00:00Z')

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

test('GA98: paid airport deposits are strictly preserved across isAirportDepositPaid and payments table records', () => {
  const oldTime = Date.parse('2026-10-07T08:00:00Z')
  const now = Date.parse('2026-10-07T12:00:00Z')

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

test('GA98: holdTtlCronAuthorized supports overrides.cronSecret for isolated testing', () => {
  const req = {
    headers: { authorization: 'Bearer secret_from_override_123' },
  }
  // env has placeholder
  const env = { CRON_SECRET: 'placeholder_secret' }
  const authorized = holdTtlCronAuthorized(req, env, { cronSecret: 'secret_from_override_123' })
  assert.equal(authorized, true, 'overrides.cronSecret is respected')

  const wrongReq = {
    headers: { authorization: 'Bearer wrong_token' },
  }
  assert.equal(holdTtlCronAuthorized(wrongReq, env, { cronSecret: 'secret_from_override_123' }), false)
})
