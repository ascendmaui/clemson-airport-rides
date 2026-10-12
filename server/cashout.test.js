import assert from 'node:assert/strict'
import test from 'node:test'
import { executeCashout, cashoutQuote } from './cashout.js'
import { claimedByCashout } from './endpoints/driverPayouts.js'

const NOW = new Date('2026-10-12T15:00:00Z')
const ENV = { STRIPE_SECRET_KEY: 'sk_test_x' }

function fakeDb({ account = 'acct_1', trips, cashedOut = false } = {}) {
  const state = {
    trips: trips || [{ id: 't1', driver_id: 'd1', status: 'completed', metadata: { payout: { status: 'pending', amountCents: 5000 } } }],
    cashouts: cashedOut ? [{ id: 'c0', status: 'paid' }] : [],
    settles: [],
  }
  const query = (table) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, neq: () => q, limit: () => q,
      maybeSingle: async () => ({ data: table === 'profiles' ? { stripe_account_id: account } : null, error: null }),
      then: (resolve) => resolve({ data: table === 'trips' ? state.trips : state.cashouts, error: null }),
    }
    return q
  }
  return {
    state,
    from: query,
    rpc: async (name, args) => {
      if (name === 'claim_driver_cashout') {
        if (state.cashouts.some((c) => c.status !== 'failed')) return { data: null, error: { message: 'already_cashed_out_today' } }
        const gross = 5000, fee = Math.max(args.p_fee_min_cents, Math.ceil(gross * args.p_fee_bps / 10000))
        const row = { id: `c${state.cashouts.length + 1}`, status: 'claimed', gross_cents: gross, fee_cents: fee, net_cents: gross - fee }
        state.cashouts.push(row)
        return { data: row, error: null }
      }
      state.settles.push(args)
      const row = state.cashouts.find((c) => c.id === args.p_cashout)
      row.status = args.p_status
      return { data: row, error: null }
    },
  }
}

function fakeStripe({ external = [{ object: 'card', available_payout_methods: ['instant', 'standard'], last4: '4242' }], instantError, transferError } = {}) {
  const calls = { transfers: [], payouts: [] }
  return {
    calls,
    accounts: { listExternalAccounts: async () => ({ data: external }) },
    transfers: { create: async (p, o) => { calls.transfers.push({ p, o }); if (transferError) throw new Error(transferError); return { id: `tr_${calls.transfers.length}` } } },
    payouts: { create: async (p, o) => {
      calls.payouts.push({ p, o })
      if (p.method === 'instant' && instantError) throw Object.assign(new Error('not eligible for instant payouts'), { code: instantError })
      return { id: `po_${calls.payouts.length}` }
    } },
  }
}

test('quote shows fee and net for an instant debit card', async () => {
  const q = await cashoutQuote({ sb: fakeDb(), stripe: fakeStripe(), driverId: 'd1', env: ENV, now: NOW })
  assert.deepEqual([q.state, q.method, q.grossCents, q.feeCents, q.netCents], ['ready', 'instant', 5000, 75, 4925])
})

test('instant cash-out transfers net, pays out instant, settles paid', async () => {
  const sb = fakeDb(), stripe = fakeStripe()
  const r = await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 75, env: ENV, now: NOW })
  assert.equal(r.ok, true)
  assert.equal(stripe.calls.transfers[0].p.amount, 4925)
  assert.equal(stripe.calls.transfers[0].o.idempotencyKey, 'cashout-transfer:c1')
  assert.deepEqual(stripe.calls.payouts[0].p.method, 'instant')
  assert.equal(stripe.calls.payouts[0].o.stripeAccount, 'acct_1')
  assert.equal(sb.state.settles[0].p_status, 'paid')
})

test('second cash-out the same day is refused before any Stripe call', async () => {
  const sb = fakeDb(), stripe = fakeStripe()
  await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 75, env: ENV, now: NOW })
  const again = await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 75, env: ENV, now: NOW })
  assert.equal(again.ok, false)
  assert.equal(again.error, 'already_today')
  assert.equal(stripe.calls.transfers.length, 1)
})

test('instant ineligible falls back to standard and returns the held fee', async () => {
  const sb = fakeDb(), stripe = fakeStripe({ instantError: 'instant_payouts_unsupported' })
  const r = await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 75, env: ENV, now: NOW })
  assert.equal(r.method, 'standard')
  assert.equal(r.fallbackReason, 'instant_ineligible')
  assert.equal(r.netCents, 5000)
  assert.equal(r.feeCents, 0)
  assert.equal(stripe.calls.transfers.reduce((s, c) => s + c.p.amount, 0), 5000)
  assert.equal(stripe.calls.payouts.at(-1).p.method, 'standard')
})

test('bank-only account quotes a free standard payout', async () => {
  const q = await cashoutQuote({ sb: fakeDb(), stripe: fakeStripe({ external: [{ object: 'bank_account', last4: '6789' }] }), driverId: 'd1', env: ENV, now: NOW })
  assert.deepEqual([q.state, q.method, q.feeCents, q.fallbackReason], ['ready', 'standard', 0, 'instant_ineligible'])
})

test('transfer failure releases the claim', async () => {
  const sb = fakeDb(), stripe = fakeStripe({ transferError: 'insufficient platform balance' })
  const r = await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 75, env: ENV, now: NOW })
  assert.equal(r.ok, false)
  assert.equal(sb.state.settles[0].p_ok, false)
  assert.equal(stripe.calls.payouts.length, 0)
})

test('guards: setup, zero, fee mismatch, live key, sweep window', async () => {
  const s = fakeStripe()
  assert.equal((await executeCashout({ sb: fakeDb({ account: null }), stripe: s, driverId: 'd1', expectedFeeCents: 0, env: ENV, now: NOW })).error, 'needs_setup')
  assert.equal((await executeCashout({ sb: fakeDb({ trips: [] }), stripe: s, driverId: 'd1', expectedFeeCents: 0, env: ENV, now: NOW })).error, 'zero_balance')
  assert.equal((await executeCashout({ sb: fakeDb(), stripe: s, driverId: 'd1', expectedFeeCents: 10, env: ENV, now: NOW })).error, 'fee_changed')
  assert.equal((await executeCashout({ sb: fakeDb(), stripe: s, driverId: 'd1', expectedFeeCents: 75, env: { STRIPE_SECRET_KEY: 'sk_live_x' }, now: NOW })).error, 'live_keys_blocked')
  assert.equal((await executeCashout({ sb: fakeDb(), stripe: s, driverId: 'd1', expectedFeeCents: 75, env: ENV, now: new Date('2026-10-12T12:05:00Z') })).error, 'sweep_window')
  assert.equal(s.calls.transfers.length, 0)
})

test('daily sweep skips a trip claimed by cash-out', async () => {
  const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: { payout: { status: 'cashout_pending' } } } }) }) }) }) }
  assert.equal(await claimedByCashout(sb, 't1'), true)
  assert.equal(await claimedByCashout({}, 't1'), false)
})
