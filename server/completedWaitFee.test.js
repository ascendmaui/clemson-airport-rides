import test from 'node:test'
import assert from 'node:assert/strict'
import { settleTrip } from './tripSettle.js'
import { chargeWaitFees, applyTripWait } from './tripWait.js'
import { buildPayoutRecord, attemptDriverPayout } from './payouts.js'
import { runDuePayouts } from './endpoints/driverPayouts.js'
import { memoryCreditStore } from './credits.js'
import { defaultCollectDeps } from './collectPayment.js'
import { tripCompletionDb } from '../tests/fixtures/tripCompletionDb.js'
import { sanitizeCompletedTripForDriver } from '../src/lib/driverEarnings.js'
import { tripPayoutCents } from '../packages/rides-native/tripTags.js'
import { reportPeriod } from '../apps/driver/lib/earningsMath.ts'
import { buildReceiptText } from '../src/lib/receiptText.js'

function setup({ wait = 300, boost = 500, credits = false, fare = 4000, noHold = false } = {}) {
  const trip = {
    id: 'wait-trip', rider_id: 'r1', driver_id: 'd1', status: 'in_progress',
    fare_cents: fare, wait_fee_cents: wait, driver_wait_earnings_cents: Math.round(wait * 0.8),
    metadata: { boost_cents: boost, ...(credits ? { billing_choice: 'credits' } : {}),
      ...(!noHold ? { fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_hold', authorizationCents: 6000, paymentMethodId: 'pm_card' } } : {}) },
  }
  const sb = tripCompletionDb(trip, { profiles: [
    { id: 'r1', stripe_customer_id: 'cus_rider', stripe_default_pm_id: 'pm_card' },
    { id: 'd1', stripe_account_id: 'acct_driver' },
  ] })
  const captures = [], charges = [], transfers = []
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: 'pi_hold', status: 'requires_capture', amount: 6000 }),
      capture: async (id, params) => { captures.push(params.amount_to_capture); return { id, status: 'succeeded', amount_received: params.amount_to_capture } },
      create: async (params) => { charges.push(params.amount); return { id: 'pi_charge', status: 'succeeded', amount: params.amount } },
      cancel: async () => assert.fail('Unexpected hold cancellation'),
    },
    transfers: { create: async (params) => { transfers.push(params.amount); return { id: 'tr_driver' } } },
  }
  const complete = (extra = {}) => settleTrip({ sb, stripe, trip, actor: { id: 'd1' }, action: 'complete', payments: sb.tables.payments, ...extra })
  return { trip, sb, stripe, captures, charges, transfers, complete }
}

for (const wait of [0, 300]) {
  test(`completion captures fare + boost + wait ${wait} and pays the stored driver share once`, async () => {
    const ctx = setup({ wait })
    const result = await ctx.complete()
    assert.equal(result.http, 200)
    assert.deepEqual(ctx.captures, [4500 + wait])
    assert.deepEqual(ctx.transfers, [3700 + Math.round(wait * 0.8)])
    assert.equal(ctx.sb.tables.payments[0].metadata.wait_fee_billed_cents, wait)
    assert.equal(ctx.sb.tables.trips[0].metadata.fare_paid_cents, 4000)
    assert.equal(result.body.payout.waitCents, Math.round(wait * 0.8))
    const replay = await ctx.complete()
    assert.equal(replay.body.idempotent, true)
    assert.equal(ctx.captures.length, 1)
    assert.equal(ctx.transfers.length, 1)
  })
}

for (const boost of [0, 500]) {
  test(`credits cover only fare; card captures wait plus boost ${boost}`, async () => {
    const ctx = setup({ credits: true, boost })
    const store = memoryCreditStore({ r1: 5000 })
    const result = await ctx.complete({ deps: { creditStore: store } })
    assert.equal(result.http, 200)
    assert.deepEqual(ctx.captures, [boost + 300])
    assert.equal((await store.getCredits('r1')).balanceCents, 1000)
    assert.equal(ctx.sb.tables.payments[0].metadata.fare_billed_cents, 0)
    assert.equal(ctx.sb.tables.trips[0].metadata.fare_paid_cents, 4000)
    assert.equal(ctx.sb.tables.trips[0].metadata.wait_fee_billed_cents, 300)
  })
}

for (const status of ['succeeded', 'pending']) {
  test(`separately billed ${status} wait fees are excluded from final capture`, async () => {
    const ctx = setup()
    ctx.sb.tables.payments.push({ trip_id: ctx.trip.id, kind: 'wait_fee', status, amount_cents: 300 })
    assert.equal((await ctx.complete()).http, 200)
    assert.deepEqual(ctx.captures, [4500])
    assert.deepEqual(ctx.charges, [])
    assert.equal(ctx.transfers[0], 3940)
  })
}

test('legacy wait completion cannot charge after settlement, even with stale trip metadata', async () => {
  const ctx = setup()
  assert.equal((await ctx.complete()).http, 200)
  const completed = ctx.sb.tables.trips[0]
  assert.equal((await chargeWaitFees(ctx.sb, completed)).reason, 'already_billed')
  // The combined payment ledger also protects against a stale metadata snapshot.
  assert.equal((await chargeWaitFees(ctx.sb, { ...completed, metadata: {} })).reason, 'already_billed')
  ctx.sb.rpc = async () => ({ data: { trip: completed, should_charge: true }, error: null })
  const replay = await applyTripWait(ctx.sb, { action: 'complete', tripId: ctx.trip.id, actorId: 'd1' })
  assert.equal(replay.charge.reason, 'already_billed')
  assert.equal(ctx.captures.length, 1)
  assert.equal(ctx.sb.tables.payments.length, 1)
})

test('wait-only payment failure returns 402 and leaves the trip in progress without payout', async () => {
  const ctx = setup({ fare: 0, boost: 0 })
  const decline = async () => { throw Object.assign(new Error('declined'), { code: 'card_declined' }) }
  ctx.stripe.paymentIntents.capture = decline
  ctx.stripe.paymentIntents.create = decline
  const result = await ctx.complete()
  assert.equal(result.http, 402)
  assert.equal(result.body.progressed, false)
  assert.equal(ctx.sb.tables.trips[0].status, 'in_progress')
  assert.equal(ctx.sb.tables.trips[0].metadata.wait_fee_billed_cents, undefined)
  assert.deepEqual(ctx.transfers, [])
})

test('a campus trip with wait due cannot complete without a saved card', async () => {
  const ctx = setup({ noHold: true, boost: 0 })
  ctx.sb.tables.profiles[0].stripe_default_pm_id = null
  const result = await ctx.complete()
  assert.equal(result.http, 402)
  assert.equal(ctx.sb.tables.trips[0].status, 'in_progress')
  assert.deepEqual(ctx.transfers, [])
})

test('saved-card fallback also collects and records fare + boost + wait', async () => {
  const ctx = setup({ noHold: true })
  const result = await ctx.complete()
  assert.equal(result.http, 200)
  assert.deepEqual(ctx.charges, [4800])
  assert.equal(ctx.sb.tables.payments[0].metadata.wait_fee_billed_cents, 300)
  assert.equal(ctx.sb.tables.trips[0].metadata.fare_paid_cents, 4000)
})

test('credits fallback charges only boost + wait to the card and debits fare once', async () => {
  const ctx = setup({ noHold: true, credits: true })
  const store = memoryCreditStore({ r1: 5000 })
  const result = await ctx.complete({ deps: { ...defaultCollectDeps(ctx.sb, ctx.stripe), creditStore: store } })
  assert.equal(result.http, 200)
  assert.deepEqual(ctx.charges, [800])
  assert.equal((await store.getCredits('r1')).balanceCents, 1000)
  assert.equal(ctx.sb.tables.payments[0].metadata.wait_fee_billed_cents, 300)
})

test('an already captured fare cannot masquerade as collection of the unpaid wait fee', async () => {
  const ctx = setup({ boost: 0 })
  Object.assign(ctx.sb.tables.trips[0].metadata, { fare_paid_cents: 4000,
    fare_authorization: { status: 'captured', capturedCents: 4000, paymentIntentId: 'pi_old' },
  })
  assert.equal((await ctx.complete()).http, 200)
  assert.deepEqual(ctx.captures, [])
  assert.deepEqual(ctx.charges, [300])
  assert.equal(ctx.sb.tables.trips[0].metadata.wait_fee_billed_cents, 300)
})

test('payout retries use the stored total including wait and paid retries are idempotent', async () => {
  const ctx = setup()
  const completed = { ...ctx.trip, status: 'completed' }
  const payout = buildPayoutRecord(completed)
  assert.equal(payout.amountCents, 3940)
  assert.equal(payout.waitCents, 240)
  // Changed input amounts must not change an already queued payout.
  const trip = { ...completed, fare_cents: 1, driver_wait_earnings_cents: 0, metadata: { payout } }
  await runDuePayouts(ctx.sb, [trip], 'acct_driver', { stripe: ctx.stripe, now: 100000 })
  assert.deepEqual(ctx.transfers, [3940])
  assert.equal(ctx.sb.tables.driver_payouts[0].amount_cents, 3940)
  const paidTrip = { ...trip, metadata: { payout: ctx.sb.tables.trips[0].metadata.payout } }
  assert.equal((await attemptDriverPayout({ trip: paidTrip, stripe: ctx.stripe, connectAccountId: 'acct_driver' })).idempotent, true)
  assert.equal(ctx.transfers.length, 1)
  assert.equal(buildPayoutRecord({ ...completed, driver_wait_earnings_cents: -10 }).waitCents, 0)
})

test('completed earnings and receipt include frozen wait without counting combined capture twice', () => {
  const { trip } = setup({ boost: 0 })
  const completed = { ...trip, status: 'completed', completed_at: '2026-10-09T16:00:00Z' }
  const web = sanitizeCompletedTripForDriver(completed, { payments: [{ kind: 'balance', status: 'succeeded', amountCents: 4300, waitFeeBilledCents: 300 }] })
  assert.equal(web.earnedCents, 3440)
  assert.equal(web.driverWaitEarningsCents, 240)
  assert.equal(tripPayoutCents(completed), 3440)
  const period = reportPeriod([completed], 'day', new Date(completed.completed_at))
  assert.equal(period.totalCents, 3440)
  assert.equal(period.platformCents, 860)
  assert.match(buildReceiptText(completed), /Wait time: \$3\.00/)
  assert.match(buildReceiptText(completed), /Total: \$43\.00/)
  assert.doesNotMatch(buildReceiptText({ ...completed, wait_fee_cents: 0 }), /Wait time/)
})
