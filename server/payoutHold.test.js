import test from 'node:test'
import assert from 'node:assert/strict'
import { payoutsHeld, heldPayoutRecord, PAYOUT_HOLD_ERROR } from './payoutHold.js'
import { attemptDriverPayout, attemptTipPayout } from './payouts.js'
import { payBonusLedger } from './perks.js'
import { executeCashout } from './cashout.js'
import { summarizeDriverEarnings } from '../shared/paymentFailure.js'
import { CASHOUT_COPY } from '../shared/cashout.js'
import { driverPayoutError } from '../shared/payoutHold.js'

const LIVE = { STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(10) }
const TEST = { STRIPE_SECRET_KEY: 'sk_test_' + 'x'.repeat(10) }

function controlsDb(row, extra = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push(table)
      const chain = {
        select() { return chain },
        eq() { return chain },
        in() { return chain },
        order() { return chain },
        limit() { return Promise.resolve({ data: [], error: null }) },
        update() { calls.push(`update:${table}`); return chain },
        upsert() { calls.push(`upsert:${table}`); return Promise.resolve({ error: null }) },
        async maybeSingle() {
          if (table === 'payout_controls') return row instanceof Error ? { data: null, error: { message: row.message } } : { data: row, error: null }
          return { data: extra[table] ?? null, error: null }
        },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
      }
      return chain
    },
    rpc() { calls.push('rpc'); return Promise.resolve({ data: null, error: { message: 'should not claim' } }) },
  }
}

function noMoneyStripe() {
  const moved = []
  return {
    moved,
    transfers: { create: async (p) => { moved.push(['transfer', p]); return { id: 'tr_x' } } },
    payouts: { create: async (p) => { moved.push(['payout', p]); return { id: 'po_x' } } },
    accounts: {
      retrieve: async (id) => ({ id, details_submitted: true, payouts_enabled: true }),
      listExternalAccounts: async () => ({ data: [{ object: 'card', last4: '4242', available_payout_methods: ['standard', 'instant'] }] }),
    },
  }
}

const trip = { id: 't1', driver_id: 'd1', status: 'completed', fare_cents: 2000, tip_cents: 300, metadata: { driver_net_cents: 1600 } }

test('payoutsHeld reads payout_controls and env', async () => {
  assert.equal(await payoutsHeld({ sb: controlsDb({ payouts_enabled: false }), env: TEST }), true)
  assert.equal(await payoutsHeld({ sb: controlsDb({ payouts_enabled: true }), env: LIVE }), false)
  assert.equal(await payoutsHeld({ sb: controlsDb({ payouts_enabled: true }), env: { ...LIVE, PAYOUTS_HOLD: '1' } }), true)
})

test('payoutsHeld fails closed with a live key when the row is unreadable', async () => {
  assert.equal(await payoutsHeld({ sb: controlsDb(new Error('relation does not exist')), env: LIVE }), true)
  assert.equal(await payoutsHeld({ sb: null, env: LIVE }), true)
  assert.equal(await payoutsHeld({ sb: controlsDb(null), env: LIVE }), true)
  assert.equal(await payoutsHeld({ sb: controlsDb(null), env: TEST }), false)
})

test('held trip payout makes no Stripe call and stays pending without an attempt', async () => {
  const stripe = noMoneyStripe()
  const r = await attemptDriverPayout({ trip, stripe, connectAccountId: 'acct_1', sb: controlsDb({ payouts_enabled: false }), env: LIVE })
  assert.equal(r.ok, false)
  assert.equal(r.held, true)
  assert.equal(stripe.moved.length, 0)
  assert.equal(r.payout.status, 'pending')
  assert.equal(r.payout.pending, true)
  assert.equal(r.payout.attempts, 0)
  assert.equal(r.payout.amountCents, 1600)
  assert.equal(r.payout.lastError, PAYOUT_HOLD_ERROR)
})

test('held tip payout makes no Stripe call', async () => {
  const stripe = noMoneyStripe()
  const r = await attemptTipPayout({ trip, stripe, connectAccountId: 'acct_1', sb: controlsDb({ payouts_enabled: false }), env: LIVE })
  assert.equal(r.held, true)
  assert.equal(stripe.moved.length, 0)
})

test('held bonus ledger and cash-out move no money', async () => {
  const stripe = noMoneyStripe()
  const sb = controlsDb({ payouts_enabled: false })
  assert.deepEqual(await payBonusLedger(sb, stripe, { env: LIVE }), [])
  const r = await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 0, env: { ...LIVE, CASHOUT_LIVE_ENABLED: '1' } })
  assert.equal(r.ok, false)
  assert.equal(r.error, PAYOUT_HOLD_ERROR)
  assert.equal(stripe.moved.length, 0)
  assert.equal(sb.calls.includes('rpc'), false)
})

test('drivers see held earnings as pending payout, not an error', () => {
  const s = summarizeDriverEarnings([{ id: 't1', metadata: { payout: heldPayoutRecord({ attempts: 0 }, 1600) } }])
  assert.equal(s.pendingCents, 1600)
  assert.equal(s.pending[0].status, 'pending')
  assert.equal(s.pending[0].lastError, null)
  assert.equal(s.pending[0].onHold, true)
  assert.match(CASHOUT_COPY.payouts_on_hold, /pending payout/)
  assert.equal(driverPayoutError('no_connect_account'), 'no_connect_account')
})

test('the daily sweep endpoint moves no money while held', async () => {
  const { default: handler } = await import('./endpoints/driverPayouts.js')
  const stripe = noMoneyStripe()
  const sb = controlsDb({ payouts_enabled: false })
  const res = { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, end(b) { this.body = b }, json(b) { this.body = JSON.stringify(b) } }
  await handler({ method: 'GET', url: '/api/driver-payouts', headers: { authorization: 'Bearer x' } }, res, { sb, env: LIVE, cronAuthorized: () => true, stripe })
  const body = JSON.parse(res.body)
  assert.equal(body.held, true)
  assert.deepEqual(body.results, [])
  assert.equal(stripe.moved.length, 0)
  assert.equal(sb.calls.includes('trips'), false)
})
