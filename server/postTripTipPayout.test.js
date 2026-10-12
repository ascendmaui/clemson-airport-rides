import test from 'node:test'
import assert from 'node:assert/strict'
import { attemptTipPayout, tipPayoutPlan } from './payouts.js'
import { runDuePayouts } from './endpoints/driverPayouts.js'
import { summarizeDriverEarnings } from '../shared/paymentFailure.js'
import { sanitizeCompletedTripForDriver } from '../src/lib/driverEarnings.js'
import { splitPlatformCut } from '../src/lib/platformFee.js'

function memSb(trips) {
  const byId = new Map(trips.map((t) => [t.id, t]))
  const ledger = []
  return {
    ledger,
    from(table) {
      if (table === 'backup_driver_payouts') {
        return { upsert(row) { const i = ledger.findIndex((r) => r.trip_id === row.trip_id && r.role === row.role); if (i >= 0) ledger[i] = row; else ledger.push(row); return Promise.resolve({ error: null }) } }
      }
      if (table === 'profiles') {
        return { select() { return { eq() { return { maybeSingle: async () => ({ data: { stripe_account_id: 'acct_d1' }, error: null }) } } } } }
      }
      let id = null
      const api = {
        select() { return api },
        eq(_c, v) { id = v; return api },
        maybeSingle: async () => ({ data: byId.get(id) ? { metadata: { ...byId.get(id).metadata } } : null, error: null }),
        update(patch) { return { eq(_c, v) { const t = byId.get(v); if (t && patch.metadata) t.metadata = patch.metadata; return Promise.resolve({ error: null }) } } },
      }
      return api
    },
  }
}

const completed = (extra = {}) => ({
  id: 'trip-tip', driver_id: 'd1', status: 'completed', fare_cents: 4000, tip_cents: 500,
  metadata: { payout: { status: 'paid', amountCents: 3200 } }, ...extra,
})

test('fee removal: tips are never in the platform fee', () => {
  assert.equal(splitPlatformCut({ fareCents: 4000, tipCents: 500 }).platformFeeCents, 800)
  const row = sanitizeCompletedTripForDriver({ id: 't', status: 'completed', fare_cents: 4000, tip_cents: 500, metadata: {} })
  assert.equal(row.tipCents, 500)
  assert.equal(row.platformFeeCents, 800)
  assert.equal(row.earnedCents, 3200 + 500)
})

test('ledger inclusion: a post-trip tip gets its own 100% transfer and ledger row', async () => {
  const trip = completed()
  const sb = memSb([trip])
  const stripe = { transfers: { calls: [], async create(p, o) { this.calls.push({ p, o }); return { id: 'tr_tip' } } } }
  const results = await runDuePayouts(sb, [trip], null, { stripe, attemptStandbyBackupPayout: async () => null, attemptSwitchFeePayout: async () => null })
  assert.equal(stripe.transfers.calls.length, 1)
  assert.equal(stripe.transfers.calls[0].p.amount, 500)
  assert.equal(stripe.transfers.calls[0].p.destination, 'acct_d1')
  assert.match(stripe.transfers.calls[0].o.idempotencyKey, /^payout-tip:trip-tip:/)
  assert.equal(trip.metadata.tip_payout.status, 'paid')
  assert.equal(trip.metadata.tip_payout.amountCents, 500)
  assert.equal(sb.ledger[0].role, 'tip')
  assert.equal(sb.ledger[0].amount_cents, 500)
  assert.equal(results.find((r) => r.role === 'tip').amountCents, 500)
  const summary = summarizeDriverEarnings([trip])
  assert.equal(summary.tipsPaidCents, 500)
  assert.equal(summary.paidCents, 3700)
})

test('idempotency: a paid tip is never transferred again', async () => {
  const trip = completed()
  const sb = memSb([trip])
  const stripe = { transfers: { calls: [], async create(p, o) { this.calls.push({ p, o }); return { id: 'tr_tip' } } } }
  const deps = { stripe, attemptStandbyBackupPayout: async () => null, attemptSwitchFeePayout: async () => null }
  await runDuePayouts(sb, [trip], null, deps)
  await runDuePayouts(sb, [trip], null, deps)
  const again = await attemptTipPayout({ sb, trip, stripe })
  assert.equal(again.idempotent, true)
  assert.equal(stripe.transfers.calls.length, 1)
})

test('failed tip transfer stays pending and retries with the same plan', async () => {
  const trip = completed()
  const sb = memSb([trip])
  const stripe = { transfers: { async create() { throw new Error('insufficient platform balance') } } }
  const r = await attemptTipPayout({ sb, trip, stripe })
  assert.equal(r.ok, false)
  assert.notEqual(trip.metadata.tip_payout.status, 'paid')
  assert.equal(trip.metadata.tip_payout.lastError, 'insufficient platform balance')
  assert.equal(summarizeDriverEarnings([trip]).tipsPendingCents, 500)
})

test('cancelled, refunded, e2e, or zero-tip trips get no tip payout', () => {
  assert.equal(tipPayoutPlan(completed({ status: 'canceled' })), null)
  assert.equal(tipPayoutPlan(completed({ status: 'cancelled_wait' })), null)
  assert.equal(tipPayoutPlan(completed({ metadata: { tip_refunded: true } })), null)
  assert.equal(tipPayoutPlan(completed({ metadata: { e2e_test: true } })), null)
  assert.equal(tipPayoutPlan(completed({ tip_cents: 0 })), null)
  const canceledRow = sanitizeCompletedTripForDriver({ id: 'c', status: 'canceled', fare_cents: 4000, tip_cents: 500, metadata: {} })
  assert.equal(canceledRow.tipCents, null)
  assert.equal(canceledRow.earnedCents, 0)
})

test('dry run reports the tip without calling Stripe', async () => {
  const trip = completed()
  const sb = memSb([trip])
  const results = await runDuePayouts(sb, [trip], null, { stripe: null, dryRun: true, attemptStandbyBackupPayout: async () => null, attemptSwitchFeePayout: async () => null })
  const tip = results.find((r) => r.role === 'tip')
  assert.equal(tip.wouldTransfer, true)
  assert.equal(trip.metadata.tip_payout, undefined)
})
