import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptDriverPayout, buildPayoutRecord } from './payouts.js'

test('buildPayoutRecord initializes pending record from trip fare', () => {
  const trip = {
    id: 'trip_1',
    driver_id: 'driver_1',
    fare_cents: 5000,
  }
  const record = buildPayoutRecord(trip)
  assert.equal(record.tripId, 'trip_1')
  assert.equal(record.driverId, 'driver_1')
  assert.equal(record.amountCents, 4000, 'Driver gets 80% default net')
  assert.equal(record.status, 'pending')
  assert.equal(record.pending, true)
  assert.equal(record.attempts, 0)
})

test('buildPayoutRecord sets $0 trips to paid immediately', () => {
  const zeroTrip = {
    id: 'trip_0',
    driver_id: 'driver_1',
    fare_cents: 0,
  }
  const record = buildPayoutRecord(zeroTrip)
  assert.equal(record.amountCents, 0)
  assert.equal(record.status, 'paid')
  assert.equal(record.pending, false)
})

test('attemptDriverPayout succeeds immediately for $0 trips', async () => {
  const trip = { id: 'trip_zero', driver_id: 'driver_1', fare_cents: 0 }
  const res = await attemptDriverPayout({ trip, stripe: {}, connectAccountId: 'acct_1' })
  assert.equal(res.ok, true)
  assert.equal(res.zero, true)
  assert.equal(res.payout.status, 'paid')
})

test('attemptDriverPayout returns idempotent success for already paid trips', async () => {
  const trip = {
    id: 'trip_paid',
    driver_id: 'driver_1',
    metadata: {
      payout: {
        tripId: 'trip_paid',
        status: 'paid',
        amountCents: 4000,
        stripeTransferId: 'tr_existing',
      },
    },
  }
  const res = await attemptDriverPayout({ trip, stripe: {}, connectAccountId: 'acct_1' })
  assert.equal(res.ok, true)
  assert.equal(res.idempotent, true)
  assert.equal(res.payout.stripeTransferId, 'tr_existing')
})

test('attemptDriverPayout records failure when driver lacks Connect account', async () => {
  const trip = { id: 'trip_no_acct', driver_id: 'driver_unlinked', fare_cents: 5000 }
  const res = await attemptDriverPayout({ trip, stripe: {}, connectAccountId: null })
  assert.equal(res.ok, false)
  assert.equal(res.payout.lastError, 'no_connect_account')
  assert.equal(res.payout.attempts, 1)
  assert.equal(res.payout.status, 'pending', 'Stays pending while retrying on backoff')
  assert.equal(res.payout.pending, true)
})

test('attemptDriverPayout calls Stripe transfers and marks payout paid', async () => {
  let transferPayload = null
  let transferOpts = null
  const mockStripe = {
    transfers: {
      create: async (payload, opts) => {
        transferPayload = payload
        transferOpts = opts
        return { id: 'tr_test_999' }
      },
    },
  }

  const trip = { id: 'trip_success', driver_id: 'driver_42', fare_cents: 6000 }
  const res = await attemptDriverPayout({
    trip,
    stripe: mockStripe,
    connectAccountId: 'acct_stripe_42',
    now: 1700000000000,
  })

  assert.equal(res.ok, true)
  assert.equal(res.payout.status, 'paid')
  assert.equal(res.payout.stripeTransferId, 'tr_test_999')
  assert.equal(transferPayload.amount, 4800)
  assert.equal(transferPayload.destination, 'acct_stripe_42')
  assert.equal(transferPayload.transfer_group, 'trip_success')
  assert.equal(transferOpts.idempotencyKey, 'payout:trip_success:0')
})

test('attemptDriverPayout handles Stripe API errors with retry backoff', async () => {
  const mockStripe = {
    transfers: {
      create: async () => {
        throw new Error('Balance insufficient')
      },
    },
  }

  const trip = { id: 'trip_err', driver_id: 'driver_42', fare_cents: 6000 }
  const now = 1700000000000
  const res = await attemptDriverPayout({
    trip,
    stripe: mockStripe,
    connectAccountId: 'acct_stripe_42',
    now,
  })

  assert.equal(res.ok, false)
  assert.equal(res.payout.status, 'pending', 'Stays pending while retrying on backoff')
  assert.equal(res.payout.pending, true)
  assert.equal(res.payout.attempts, 1)
  assert.equal(res.payout.lastError, 'Balance insufficient')
  assert.ok(new Date(res.payout.nextRetryAt).getTime() > now, 'Next retry is scheduled in future')

  // Calling again before nextRetryAt elapses should skip with reason not_due
  const retryTrip = {
    ...trip,
    metadata: { payout: res.payout },
  }
  const skipRes = await attemptDriverPayout({
    trip: retryTrip,
    stripe: mockStripe,
    connectAccountId: 'acct_stripe_42',
    now: now + 1000, // Only 1 second later
  })
  assert.equal(skipRes.ok, false)
  assert.equal(skipRes.skipped, true)
  assert.equal(skipRes.reason, 'not_due')
})
