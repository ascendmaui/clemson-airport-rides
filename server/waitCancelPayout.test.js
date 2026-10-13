import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attemptDriverPayout, buildPayoutRecord, buildWaitCancelPayoutRecord, enqueueWaitCancelPayout } from './payouts.js'
import { applyTripWait } from './tripWait.js'
import { runDuePayouts } from './endpoints/driverPayouts.js'
import { tripCompletionDb } from '../tests/fixtures/tripCompletionDb.js'
import { sanitizeCompletedTripForDriver, summarizeDriverEarnings } from '../src/lib/driverEarnings.js'
import { reportPeriod } from '../apps/driver/lib/earningsMath.ts'

const now = Date.parse('2026-10-09T16:00:00Z')
function trip(cents = 400) {
  return { id: 'wait-trip', driver_id: 'driver', rider_id: 'rider', status: 'cancelled_wait',
    arrived_at: new Date(now - 420000).toISOString(), canceled_at: new Date(now).toISOString(),
    fare_cents: 9000, boost_cents: 1500, wait_fee_cents: cents === 400 ? 400 : 200,
    cancel_fee_cents: cents === 400 ? 100 : 0, driver_wait_earnings_cents: cents,
    metadata: { driver_net_cents: 7200, driver_payout_cents: 7200, preserved: true } }
}
const db = (row) => tripCompletionDb(row, { profiles: [{ id: 'driver', stripe_account_id: 'acct_driver' }] })

test('explicit wait payout and generic builder exclude fare, boost and bonuses', () => {
  for (const amount of [0, 160, 400]) {
    const row = trip(amount)
    for (const record of [buildPayoutRecord(row), buildWaitCancelPayoutRecord(row)]) {
      assert.equal(record.amountCents, amount)
      assert.equal(record.fareNetCents, 0)
      assert.equal(record.boostCents, 0)
      assert.equal(record.kind, 'wait_cancel')
    }
  }
  assert.equal(buildPayoutRecord({ ...trip(), status: 'canceled' }).amountCents, 0)
})
test('enqueue pays exact stored wait earnings once and preserves the unique trip queue row', async () => {
  const row = trip(160), sb = db(row), calls = []
  const stripe = { transfers: { create: async (params, options) => { calls.push({ params, options }); return { id: 'tr_wait' } } } }
  const first = await enqueueWaitCancelPayout({ sb, trip: row, stripe, now })
  const second = await enqueueWaitCancelPayout({ sb, trip: row, stripe, now })
  assert.equal(first.ok, true)
  assert.equal(first.payout.amountCents, 160)
  assert.equal(first.payout.fareNetCents, 0)
  assert.equal(second.idempotent, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.amount, 160)
  assert.equal(calls[0].options.idempotencyKey, 'payout-wait:wait-trip')
  assert.equal(sb.tables.driver_payouts.length, 1)
  assert.equal(sb.tables.driver_payouts[0].amount_cents, 160)
  assert.equal(sb.tables.trips[0].metadata.preserved, true)
})
test('wait transfer key survives stale/concurrent attempts and missing amount never falls back to fare', async () => {
  const keys = [], amounts = []
  const row = trip()
  row.metadata.payout = { status: 'pending', attempts: 3, nextRetryAt: now - 1, amountCents: 7200 }
  const stripe = { transfers: { create: async (params, options) => { keys.push(options.idempotencyKey); amounts.push(params.amount); return { id: 'tr_one' } } } }
  await Promise.all([1, 2].map(() => attemptDriverPayout({ trip: row, stripe, connectAccountId: 'acct_driver', now })))
  assert.deepEqual(keys, ['payout-wait:wait-trip', 'payout-wait:wait-trip'])
  assert.deepEqual(amounts, [400, 400])
  delete row.metadata.payout.amountCents
  const result = await attemptDriverPayout({ trip: row, stripe, connectAccountId: 'acct_driver', now })
  assert.equal(result.payout.amountCents, 400)
})
test('daily retries preserve wait amount, including dry runs, and select wait cancellations', async () => {
  const row = trip(160), sb = db(row)
  row.metadata.payout = { status: 'pending', attempts: 1, nextRetryAt: now - 1 }
  const preview = await runDuePayouts(sb, [row], 'acct_driver', { now, stripe: null, dryRun: true })
  assert.equal(preview[0].amountCents, 160)
  let amount
  const stripe = { transfers: { create: async params => { amount = params.amount; return { id: 'tr_retry' } } } }
  await runDuePayouts(sb, [row], 'acct_driver', { now, stripe })
  assert.equal(amount, 160)
  assert.equal(sb.tables.driver_payouts[0].amount_cents, 160)
  const source = readFileSync(new URL('./endpoints/driverPayouts.js', import.meta.url), 'utf8')
  assert.equal((source.match(/\.in\('status', \['completed', 'cancelled_wait'\]\)/g) || []).length, 2)
  assert.match(source, /select\('[^']*driver_wait_earnings_cents/)
})
test('applyTripWait queues payout only after succeeded charge, also on a late start', async () => {
  for (const status of ['succeeded', 'pending', 'failed']) {
    const row = trip(), sb = db(row), calls = []
    sb.rpc = async () => ({ data: { trip: row, should_charge: true, server_now: new Date(now).toISOString() } })
    const stripe = { transfers: { create: async params => { calls.push(params.amount); return { id: 'tr_wait' } } } }
    const result = await applyTripWait(sb, { action: 'start', tripId: row.id, actorId: row.driver_id }, {
      stripe, chargeWaitFees: async () => ({ status, amountCents: 500 }),
    })
    assert.equal(result.trip.status, 'cancelled_wait')
    assert.equal(result.charge.status, status)
    assert.deepEqual(calls, status === 'succeeded' ? [400] : [])
    assert.equal(sb.tables.driver_payouts.length, status === 'succeeded' ? 1 : 0)
  }
})
test('failed driver transfer remains queued and retry is idempotent', async () => {
  const row = trip(), sb = db(row)
  const first = await enqueueWaitCancelPayout({ sb, trip: row, stripe: null, now })
  assert.equal(first.ok, false)
  assert.equal(sb.tables.driver_payouts[0].amount_cents, 400)
  const calls = []
  const stripe = { transfers: { create: async (params, options) => { calls.push(options.idempotencyKey); return { id: 'tr_retry' } } } }
  await enqueueWaitCancelPayout({ sb, trip: row, stripe, now: now + 60001 })
  await enqueueWaitCancelPayout({ sb, trip: row, stripe, now: now + 60002 })
  assert.deepEqual(calls, ['payout-wait:wait-trip'])
  assert.equal(sb.tables.driver_payouts.length, 1)
  assert.equal(sb.tables.driver_payouts[0].status, 'paid')
})
test('web and native period earnings count no-show earnings on canceled_at without fare', () => {
  for (const cents of [160, 400]) {
    const row = trip(cents)
    const web = sanitizeCompletedTripForDriver(row, { bill: { baseCents: 9000, timeCents: 1000 } })
    assert.equal(web.earnedCents, cents)
    assert.equal(web.fareCents, 0)
    assert.equal(web.boostCents, 0)
    assert.equal(web.grossCents, row.wait_fee_cents + row.cancel_fee_cents)
    assert.equal(web.completedAt, row.canceled_at)
    assert.deepEqual(web.fareParts, [{ label: 'No-show fee', cents }])
    const summary = summarizeDriverEarnings([web], { now: new Date(now), timeZone: 'America/New_York' })
    assert.equal(summary.weekEarningsCents, cents)
    const native = reportPeriod([row], 'week', new Date(now))
    assert.equal(native.totalCents, cents)
    assert.equal(native.canceled, 1)
    assert.equal(native.completed, 0)
  }
})
