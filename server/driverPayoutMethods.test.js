import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import handler from './endpoints/driverPayoutMethods.js'
import { handleDriverConnectEvent } from './driverPayoutMethods.js'
import { expressTestKeyAllowed, payoutStatusChip, publicPayoutMethod, shouldApplyPayoutStatus } from '../shared/driverPayoutMethods.js'

const ENV = { STRIPE_SECRET_KEY: 'sk_test_driver' }
const USER = { id: 'd1', email: 'ada@clemson.edu' }

function mockRes() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function call(req, deps) {
  const res = mockRes()
  await handler(req, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

function memory({ account = null, trips, cashedOut = false } = {}) {
  const state = {
    profiles: [{ id: 'd1', stripe_account_id: account, stripe_connect_id: null, stripe_details_submitted: false, stripe_payouts_enabled: false }],
    trips: trips || [{ id: 't1', driver_id: 'd1', status: 'completed', metadata: { payout: { status: 'pending', amountCents: 5000 } } }],
    cashouts: cashedOut ? [{ id: 'c0', status: 'paid' }] : [],
    events: [],
  }
  function from(table) {
    const filters = []
    const api = {
      select() { return api },
      eq(col, val) { filters.push([col, val]); return api },
      in() { return api },
      neq() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle: async () => ({ data: rowFor(table, filters, state), error: null }),
      update(patch) {
        return {
          eq(col, val) {
            const rows = table === 'profiles' ? state.profiles : state.events
            const row = rows.find((item) => item[col] === val)
            if (row) Object.assign(row, patch)
            return { error: null }
          },
        }
      },
      insert: async (row) => {
        const saved = { id: `evt-row-${state.events.length + 1}`, ...row }
        state.events.push(saved)
        return { error: null }
      },
      then(resolve) {
        if (table === 'trips') return resolve({ data: state.trips, error: null })
        if (table === 'driver_cashouts') return resolve({ data: state.cashouts, error: null })
        if (table === 'driver_payout_events') {
          const driver = filters.find((pair) => pair[0] === 'driver_id')?.[1]
          const data = driver ? state.events.filter((row) => row.driver_id === driver) : state.events
          return resolve({ data, error: null })
        }
        return resolve({ data: [], error: null })
      },
    }
    return api
  }
  return {
    state,
    from,
    rpc: async (name, args) => {
      if (name !== 'claim_driver_cashout') {
        const row = state.cashouts.find((item) => item.id === args.p_cashout)
        if (row) row.status = args.p_status
        return { data: row, error: null }
      }
      if (state.cashouts.some((item) => item.status !== 'failed')) {
        return { data: null, error: { message: 'already_cashed_out_today' } }
      }
      const gross = 5000
      const fee = Math.max(args.p_fee_min_cents, Math.ceil((gross * args.p_fee_bps) / 10000))
      const row = { id: `c${state.cashouts.length + 1}`, status: 'claimed', gross_cents: gross, fee_cents: fee, net_cents: gross - fee }
      state.cashouts.push(row)
      return { data: row, error: null }
    },
  }
}

function rowFor(table, filters, state) {
  if (table === 'profiles') {
    return state.profiles.find((row) => filters.every(([col, val]) => row[col] === val)) || null
  }
  if (table === 'driver_payout_events') {
    const payout = filters.find((pair) => pair[0] === 'stripe_payout_id')?.[1]
    return state.events.find((row) => row.stripe_payout_id === payout) || null
  }
  return null
}

function stripeMock(external) {
  const calls = { create: [], links: [], payouts: [], transfers: [], balance: null }
  const accounts = external || [{
    id: 'card_1', object: 'card', last4: '4242', brand: 'Visa', default_for_currency: true,
    available_payout_methods: ['instant', 'standard'], account_number: '000123456789',
  }]
  return {
    calls,
    accounts: {
      create: async (params) => { calls.create.push(params); return { id: 'acct_new' } },
      retrieve: async () => ({ id: 'acct_1', details_submitted: true, payouts_enabled: true }),
      listExternalAccounts: async (_id, params) => {
        const data = params?.object ? accounts.filter((row) => row.object === params.object) : accounts
        return { data }
      },
      createLoginLink: async () => ({ url: 'https://connect.stripe.com/express/login' }),
    },
    accountLinks: {
      create: async (params) => { calls.links.push(params); return { url: 'https://connect.stripe.com/setup/s/driver' } },
    },
    balance: {
      retrieve: async (_params, options) => {
        calls.balance = options
        return { available: [{ currency: 'usd', amount: 1200 }], pending: [{ currency: 'usd', amount: 340 }] }
      },
    },
    transfers: {
      create: async (params, options) => { calls.transfers.push({ params, options }); return { id: 'tr_1' } },
    },
    payouts: {
      create: async (params, options) => { calls.payouts.push({ params, options }); return { id: 'po_1' } },
    },
  }
}

test('a live Stripe key is refused before any account or payout call', async () => {
  assert.equal(expressTestKeyAllowed('sk_live_crimson'), false)
  assert.equal(expressTestKeyAllowed('rk_live_crimson'), false)
  assert.equal(expressTestKeyAllowed('sk_test_driver'), true)
  const stripe = stripeMock()
  const res = await call(
    { method: 'POST', headers: { origin: 'https://clemsonrides.com' }, body: { op: 'setup' } },
    { sb: memory(), user: USER, stripe, env: { STRIPE_SECRET_KEY: 'sk_live_crimson' } },
  )
  assert.equal(res.status, 403)
  assert.equal(res.json.error, 'live_keys_blocked')
  assert.equal(stripe.calls.create.length, 0)
  assert.equal(stripe.calls.links.length, 0)
  const cash = await call(
    { method: 'POST', headers: {}, body: { op: 'cashout', confirm: true, method: 'instant', feeCents: 75 } },
    { sb: memory({ account: 'acct_1' }), user: USER, stripe, env: { STRIPE_SECRET_KEY: 'sk_live_crimson' } },
  )
  assert.equal(cash.status, 403)
  assert.equal(stripe.calls.payouts.length, 0)
})

test('direct deposit setup opens a Stripe Express onboarding link', async () => {
  const stripe = stripeMock()
  const sb = memory()
  const res = await call(
    { method: 'POST', headers: { origin: 'https://clemsonrides.com' }, body: { op: 'setup' } },
    { sb, user: USER, stripe, env: ENV },
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.url, 'https://connect.stripe.com/setup/s/driver')
  assert.equal(res.json.type, 'account_onboarding')
  assert.equal(stripe.calls.create[0].type, 'express')
  assert.equal(stripe.calls.create[0].country, 'US')
  assert.equal(stripe.calls.create[0].metadata.program, 'driver')
  assert.equal(stripe.calls.create[0].metadata.driver_id, 'd1')
  assert.equal(stripe.calls.create[0].capabilities.transfers.requested, true)
  assert.equal(stripe.calls.links[0].type, 'account_onboarding')
  assert.match(stripe.calls.links[0].return_url, /#\/driver-payouts$/)
  assert.equal(sb.state.profiles[0].stripe_account_id, 'acct_new')

  const update = await call(
    { method: 'POST', headers: { origin: 'http://localhost:5173' }, body: { op: 'setup' } },
    { sb: memory({ account: 'acct_1' }), user: USER, stripe, env: ENV },
  )
  assert.equal(update.json.type, 'account_update')
})

test('instant cash out charges the fee and standard cash out is free', async () => {
  // Cash-out is paused 11:50–12:30 UTC. Pin the clock so CI does not hit sweep_window.
  const now = new Date('2026-10-13T15:00:00Z')
  const instantStripe = stripeMock()
  const instant = await call(
    { method: 'POST', headers: {}, body: { op: 'cashout', confirm: true, method: 'instant', feeCents: 75 } },
    { sb: memory({ account: 'acct_1' }), user: USER, stripe: instantStripe, env: ENV, now },
  )
  assert.equal(instant.status, 200)
  assert.equal(instant.json.method, 'instant')
  assert.equal(instant.json.feeCents, 75)
  assert.equal(instantStripe.calls.transfers[0].params.amount, 4925)
  assert.equal(instantStripe.calls.payouts[0].params.method, 'instant')
  assert.equal(instantStripe.calls.payouts[0].options.stripeAccount, 'acct_1')

  const standardStripe = stripeMock()
  const standard = await call(
    { method: 'POST', headers: {}, body: { op: 'cashout', confirm: true, method: 'standard', feeCents: 0 } },
    { sb: memory({ account: 'acct_1' }), user: USER, stripe: standardStripe, env: ENV, now },
  )
  assert.equal(standard.status, 200)
  assert.equal(standard.json.method, 'standard')
  assert.equal(standard.json.feeCents, 0)
  assert.equal(standard.json.netCents, 5000)
  assert.equal(standardStripe.calls.payouts[0].params.method, 'standard')
  assert.equal(standardStripe.calls.transfers[0].params.amount, 5000)
})

test('the payout desk shows available and pending balances and last 4 only', async () => {
  const stripe = stripeMock()
  const res = await call(
    { method: 'GET', headers: { origin: 'https://clemsonrides.com' } },
    { sb: memory({ account: 'acct_1' }), user: USER, stripe, env: ENV },
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.availableCents, 1200)
  assert.equal(res.json.pendingCents, 340)
  assert.equal(res.json.methods[0].last4, '4242')
  assert.equal(res.json.methods[0].default, true)
  assert.equal(JSON.stringify(res.json).includes('000123456789'), false)
  assert.equal(res.json.dashboardUrl, 'https://connect.stripe.com/express/login')
  assert.equal(stripe.calls.balance.stripeAccount, 'acct_1')
  const pub = publicPayoutMethod({ object: 'bank_account', last4: '6789', bank_name: 'Bank', default_for_currency: true, account_number: '999' })
  assert.equal(pub.last4, '6789')
  assert.equal(JSON.stringify(pub).includes('999'), false)
})

test('webhook status chips move pending to in transit to paid and do not rewind', async () => {
  const sb = memory({ account: 'acct_1' })
  const created = await handleDriverConnectEvent(sb, {
    id: 'evt_1', type: 'payout.created', livemode: false, account: 'acct_1',
    data: { object: { id: 'po_9', amount: 4925, currency: 'usd', status: 'pending', method: 'instant' } },
  })
  assert.equal(created.status, 'pending')
  assert.equal(sb.state.events[0].status, 'pending')
  const transit = await handleDriverConnectEvent(sb, {
    id: 'evt_2', type: 'payout.updated', livemode: false, account: 'acct_1',
    data: { object: { id: 'po_9', amount: 4925, status: 'in_transit', method: 'instant' } },
  })
  assert.equal(transit.status, 'in_transit')
  assert.equal(sb.state.events.length, 1)
  const paid = await handleDriverConnectEvent(sb, {
    id: 'evt_3', type: 'payout.paid', livemode: false, account: 'acct_1',
    data: { object: { id: 'po_9', amount: 4925, status: 'paid', method: 'instant' } },
  })
  assert.equal(paid.status, 'paid')
  assert.equal(payoutStatusChip('in_transit'), 'in_transit')
  const rewind = await handleDriverConnectEvent(sb, {
    id: 'evt_4', type: 'payout.updated', livemode: false, account: 'acct_1',
    data: { object: { id: 'po_9', amount: 4925, status: 'pending', method: 'instant' } },
  })
  assert.equal(rewind.reason, 'status_not_rewound')
  assert.equal(sb.state.events[0].status, 'paid')
  assert.equal(shouldApplyPayoutStatus('paid', 'pending'), false)

  const failed = await handleDriverConnectEvent(sb, {
    id: 'evt_5', type: 'payout.failed', livemode: false, account: 'acct_1',
    data: { object: { id: 'po_10', amount: 1000, status: 'failed', method: 'standard' } },
  })
  assert.equal(failed.status, 'failed')
  const account = await handleDriverConnectEvent(sb, {
    id: 'evt_acct', type: 'account.updated', livemode: false,
    data: { object: { id: 'acct_1', details_submitted: true, payouts_enabled: true, metadata: { program: 'driver', driver_id: 'd1' } } },
  })
  assert.equal(account.payouts_enabled, true)
  assert.equal(sb.state.profiles[0].stripe_payouts_enabled, true)
  const live = await handleDriverConnectEvent(sb, {
    id: 'evt_live', type: 'payout.paid', livemode: true, account: 'acct_1',
    data: { object: { id: 'po_live', amount: 1, status: 'paid' } },
  })
  assert.equal(live.reason, 'live_mode')
  assert.equal(sb.state.events.some((row) => row.stripe_payout_id === 'po_live'), false)
})

test('payout methods screen reuses cash out and the daily cron schedule stays', () => {
  const screen = readFileSync(new URL('../apps/driver/app/payouts.tsx', import.meta.url), 'utf8')
  const web = readFileSync(new URL('../src/screens/DriverPayouts.jsx', import.meta.url), 'utf8')
  const cron = readFileSync(new URL('../supabase/migrations/20261006055405_driver_payouts_pg_cron.sql', import.meta.url), 'utf8')
  const sql = readFileSync(new URL('../supabase/migrations/20261013193000_driver_connect_payouts.sql', import.meta.url), 'utf8')
  assert.match(screen, /Instant cash out/)
  assert.match(screen, /Standard \(free, 1-2 days\)/)
  assert.match(screen, /Available balance/)
  assert.match(screen, /Pending balance/)
  assert.match(screen, /cashOutPayout/)
  assert.match(web, /Instant cash out/)
  assert.match(web, /Standard \(free, 1-2 days\)/)
  assert.match(cron, /'0 12 \* \* \*'/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /driver_id = auth\.uid\(\)/)
  assert.doesNotMatch(sql, /drop table/i)
  assert.equal(expressTestKeyAllowed(''), false)
})
