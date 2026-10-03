import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createFakeSb } from '../tests/fixtures/admin-support/adminDeskSb.js'
import { formatUsdFromCents } from '../shared/paymentFailure.js'
import { runAdminMoneyAction, stripeRefundCaller } from './adminMoney.js'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('STRIPE_') || key.startsWith('SUPABASE_') || key.startsWith('GOOGLE_')) {
    delete process.env[key]
  }
}

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'johnmatveyev@gmail.com' }
const ACCESS = { admin: true, profile: { email: 'johnmatveyev@gmail.com', role: 'admin' } }
const RIDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const DRIVER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const REQUEST_ID = '12121212-1212-4121-8121-121212121212'
const TRIP_ID = '11111111-1111-4111-8111-111111111111'
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222'

const RIDER = { id: RIDER_ID, full_name: 'Ada Lovelace', email: 'ada@clemson.edu', role: 'rider' }
const DRIVER = { id: DRIVER_ID, full_name: 'Kim Chen', email: 'kim@clemson.edu', role: 'driver' }

function stripeSpy() {
  const calls = []
  const stripe = {
    refunds: {
      create: async (params, options) => {
        calls.push({ method: 'refunds.create', params, options })
        return { id: 're_test', amount: params.amount, status: 'succeeded' }
      },
    },
    charges: {
      create: async () => {
        calls.push({ method: 'charges.create' })
        throw new Error('must not charge')
      },
    },
    paymentIntents: {
      create: async () => {
        calls.push({ method: 'paymentIntents.create' })
        throw new Error('must not charge')
      },
    },
    subscriptions: {
      update: async () => {
        calls.push({ method: 'subscriptions.update' })
        throw new Error('must not change subscription')
      },
    },
    customers: {
      update: async () => {
        calls.push({ method: 'customers.update' })
        throw new Error('must not change customer')
      },
    },
    transfers: {
      create: async () => {
        calls.push({ method: 'transfers.create' })
        throw new Error('must not transfer')
      },
    },
  }
  return { stripe, calls }
}

function creditSpy() {
  const calls = []
  return {
    calls,
    async applyCredits(userId, delta, meta) {
      calls.push({ userId, delta, meta })
      return { ok: true, duplicate: false, balanceCents: 5000 }
    },
  }
}

function sbWith({ profile, payments = [], payouts = [] } = {}) {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'profiles', () => ({ data: profile, error: null }))
  sb.when((ctx) => ctx.table === 'payments' && ctx.op === 'select', () => ({ data: payments, error: null }))
  sb.when((ctx) => ctx.table === 'payments' && ctx.op === 'insert', () => ({ data: { id: 'pay-1' }, error: null }))
  sb.when((ctx) => ctx.table === 'rider_credit_ledger' && ctx.op === 'select', () => ({ data: [], error: null }))
  sb.when((ctx) => ctx.table === 'rider_credit_ledger' && ctx.op === 'insert', () => ({ data: { id: 'led-1' }, error: null }))
  sb.when((ctx) => ctx.table === 'rider_credit_lots' && ctx.op === 'insert', () => ({ data: { id: 'lot-1' }, error: null }))
  sb.when((ctx) => ctx.table === 'driver_payouts' && ctx.op === 'select', () => ({ data: payouts, error: null }))
  sb.when((ctx) => ctx.table === 'driver_payouts' && ctx.op === 'insert', () => ({ data: { id: 'payout-1' }, error: null }))
  sb.when((ctx) => ctx.table === 'trips', () => ({ data: { id: TRIP_ID, rider_id: RIDER_ID }, error: null }))
  return sb
}

function inserts(sb, table) {
  return sb.calls.filter((ctx) => ctx.table === table && ctx.op === 'insert')
}

async function run(overrides) {
  const credits = overrides.credits || creditSpy()
  const sb = overrides.sb || sbWith({ profile: overrides.profile || RIDER })
  const result = await runAdminMoneyAction({
    sb,
    action: overrides.action,
    body: overrides.body,
    adminUser: overrides.adminUser === undefined ? ADMIN : overrides.adminUser,
    access: overrides.access === undefined ? ACCESS : overrides.access,
    stripe: overrides.stripe || null,
    stripeAvailable: Boolean(overrides.stripeAvailable),
    credits,
  })
  return { ...result, sb, credits }
}

const charge = {
  id: PAYMENT_ID,
  rider_id: RIDER_ID,
  trip_id: TRIP_ID,
  kind: 'balance',
  amount_cents: 2500,
  status: 'succeeded',
  stripe_payment_intent_id: 'pi_test_charge',
  metadata: {},
}

test('stripe refund caller exposes refunds.create only', () => {
  const { stripe } = stripeSpy()
  const caller = stripeRefundCaller(stripe)
  assert.deepEqual(Object.keys(caller), ['refunds'])
  assert.equal(typeof caller.refunds.create, 'function')
  assert.equal(stripeRefundCaller({}), null)
})

test('preview refund with a card charge does not call Stripe', async () => {
  const { stripe, calls } = stripeSpy()
  const { status, body, sb, credits } = await run({
    action: 'refund',
    stripe,
    stripeAvailable: true,
    sb: sbWith({ profile: RIDER, payments: [charge] }),
    body: { profileId: RIDER_ID, amountCents: 1250, confirmed: false },
  })
  assert.equal(status, 200)
  assert.equal(body.preview, true)
  assert.equal(body.executed, false)
  assert.equal(body.settlement, 'stripe_refund')
  assert.equal(body.person.fullName, 'Ada Lovelace')
  assert.equal(body.person.email, 'ada@clemson.edu')
  assert.equal(body.amountLabel, formatUsdFromCents(1250))
  assert.match(body.confirmation, /Ada Lovelace \(ada@clemson.edu\), a rider/)
  assert.match(body.confirmation, /Stripe refund/)
  assert.match(body.confirmation, /does not charge a card/)
  assert.equal(calls.length, 0)
  assert.equal(inserts(sb, 'payments').length, 0)
  assert.equal(credits.calls.length, 0)
})

test('confirmed refund calls Stripe refunds and does not charge or transfer', async () => {
  const { stripe, calls } = stripeSpy()
  const sb = sbWith({ profile: RIDER, payments: [charge] })
  const { status, body, credits } = await run({
    action: 'refund',
    stripe,
    stripeAvailable: true,
    sb,
    body: { profileId: RIDER_ID, amountCents: 1250, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.executed, true)
  assert.equal(body.settlement, 'stripe_refund')
  assert.equal(body.stripeRefundId, 're_test')
  assert.match(body.result, /card refund, not ride credit/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'refunds.create')
  assert.equal(calls[0].params.payment_intent, 'pi_test_charge')
  assert.equal(calls[0].params.amount, 1250)
  assert.equal(calls[0].options.idempotencyKey, `admin-refund:${REQUEST_ID}`)
  assert.equal(calls[0].params.reverse_transfer, undefined)
  const payment = inserts(sb, 'payments')[0]
  assert.equal(payment.payload.kind, 'refund')
  assert.equal(payment.payload.platform_fee_cents, 0)
  assert.equal(payment.payload.driver_earnings_cents, 0)
  assert.equal(payment.payload.metadata.settlement, 'stripe_refund')
  assert.equal(credits.calls.length, 0)
  assert.equal(inserts(sb, 'rider_credit_lots').length, 0)
})

test('confirmed refund without Stripe records ride credit and does not call Stripe', async () => {
  const { stripe, calls } = stripeSpy()
  const sb = sbWith({ profile: RIDER, payments: [charge] })
  const { status, body, credits } = await run({
    action: 'refund',
    stripe,
    stripeAvailable: false,
    sb,
    body: { profileId: RIDER_ID, amountCents: 1250, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.settlement, 'recorded_credit')
  assert.match(body.confirmation, /not a Stripe refund/)
  assert.match(body.result, /ride credit/)
  assert.match(body.result, /Ada Lovelace/)
  assert.equal(calls.length, 0)
  assert.equal(credits.calls.length, 0)
  const lot = inserts(sb, 'rider_credit_lots')[0]
  assert.equal(lot.payload.profile_id, RIDER_ID)
  assert.equal(lot.payload.load_cents, 1250)
  assert.equal(lot.payload.remaining_cents, 1250)
  assert.equal(lot.payload.pack_id, 'admin_refund')
})

test('a Stripe refund failure is recorded as ride credit', async () => {
  const calls = []
  const stripe = {
    refunds: {
      create: async () => {
        calls.push('refunds.create')
        throw new Error('charge_already_refunded')
      },
    },
    charges: { create: async () => { throw new Error('must not charge') } },
  }
  const sb = sbWith({ profile: RIDER, payments: [charge] })
  const { status, body } = await run({
    action: 'refund',
    stripe,
    stripeAvailable: true,
    sb,
    body: { profileId: RIDER_ID, amountCents: 1250, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.settlement, 'recorded_credit')
  assert.match(body.result, /not a Stripe refund/)
  assert.match(body.result, /charge_already_refunded/)
  assert.equal(calls.length, 1)
  assert.equal(inserts(sb, 'rider_credit_lots').length, 1)
})

test('rider credit uses a credit lot and does not call Stripe', async () => {
  const { stripe, calls } = stripeSpy()
  const sb = sbWith({ profile: RIDER })
  const { status, body, credits } = await run({
    action: 'credit',
    stripe,
    stripeAvailable: true,
    sb,
    body: { profileId: RIDER_ID, amountCents: 1000, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.settlement, 'credit_lot')
  assert.match(body.confirmation, /Ada Lovelace \(ada@clemson.edu\), a rider/)
  assert.match(body.confirmation, /does not charge a card/)
  assert.equal(inserts(sb, 'rider_credit_lots')[0].payload.pack_id, 'admin_credit')
  assert.equal(credits.calls.length, 0)
  assert.equal(calls.length, 0)
})

test('driver credit uses the credit balance and does not pay out', async () => {
  const { stripe, calls } = stripeSpy()
  const sb = sbWith({ profile: DRIVER })
  const { status, body, credits } = await run({
    action: 'credit',
    stripe,
    sb,
    body: { profileId: DRIVER_ID, amountCents: 1500, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.settlement, 'credit_balance')
  assert.match(body.confirmation, /Kim Chen \(kim@clemson.edu\), a driver/)
  assert.match(body.confirmation, /does not send a payout/)
  assert.equal(credits.calls.length, 1)
  assert.equal(credits.calls[0].delta, 1500)
  assert.equal(credits.calls[0].meta.kind, 'admin_credit')
  assert.equal(inserts(sb, 'driver_payouts').length, 0)
  assert.equal(calls.length, 0)
})

test('driver incentive is recorded as owed and is not transferred', async () => {
  const { stripe, calls } = stripeSpy()
  const sb = sbWith({ profile: DRIVER })
  const { status, body, credits } = await run({
    action: 'incentive',
    stripe,
    stripeAvailable: true,
    sb,
    body: { profileId: DRIVER_ID, amountCents: 2000, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.settlement, 'owed_payout')
  assert.match(body.confirmation, /Kim Chen \(kim@clemson.edu\), a driver/)
  assert.match(body.confirmation, /owed/)
  assert.match(body.confirmation, /not transferred/)
  assert.match(body.result, /not transferred/)
  const payout = inserts(sb, 'driver_payouts')[0]
  assert.equal(payout.payload.status, 'owed')
  assert.equal(payout.payload.amount_cents, 2000)
  assert.equal(payout.payload.stripe_transfer_id, null)
  assert.equal(payout.payload.driver_id, DRIVER_ID)
  assert.equal(credits.calls.length, 0)
  assert.equal(calls.length, 0)
})

test('rider incentive is recorded as ride credit', async () => {
  const sb = sbWith({ profile: RIDER })
  const { status, body } = await run({
    action: 'incentive',
    sb,
    body: { profileId: RIDER_ID, amountCents: 800, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(status, 200)
  assert.equal(body.settlement, 'incentive_credit')
  assert.match(body.confirmation, /not a cash payout/)
  assert.equal(inserts(sb, 'rider_credit_lots')[0].payload.pack_id, 'admin_incentive')
  assert.equal(inserts(sb, 'driver_payouts').length, 0)
})

test('refunds reject drivers and unconfirmed requests do not write', async () => {
  const { stripe, calls } = stripeSpy()
  const sb = sbWith({ profile: DRIVER })
  const denied = await run({
    action: 'refund',
    stripe,
    stripeAvailable: true,
    sb,
    body: { profileId: DRIVER_ID, amountCents: 500, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(denied.status, 400)
  assert.match(denied.body.error, /riders/)
  assert.equal(calls.length, 0)
  assert.equal(inserts(sb, 'rider_credit_lots').length, 0)

  const preview = await run({
    action: 'credit',
    sb: sbWith({ profile: RIDER }),
    body: { profileId: RIDER_ID, amountCents: 0, confirmed: true, requestId: REQUEST_ID },
  })
  assert.equal(preview.status, 400)
})

test('riders, drivers, and other admins cannot run money actions', async () => {
  const rider = await run({
    action: 'credit',
    adminUser: { id: RIDER_ID, email: 'ada@clemson.edu' },
    access: { admin: false, profile: { email: 'ada@clemson.edu', role: 'rider' } },
    body: { profileId: RIDER_ID, amountCents: 100, confirmed: false },
  })
  assert.equal(rider.status, 403)

  const otherAdmin = await run({
    action: 'incentive',
    adminUser: { id: ADMIN.id, email: 'john@gmail.com' },
    access: { admin: true, profile: { email: 'john@gmail.com', role: 'admin' } },
    body: { profileId: DRIVER_ID, amountCents: 100, confirmed: false },
  })
  assert.equal(otherAdmin.status, 403)
})

test('repeating a confirmed refund does not call Stripe twice', async () => {
  const { stripe, calls } = stripeSpy()
  const payments = [charge]
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'profiles', () => ({ data: RIDER, error: null }))
  sb.when((ctx) => ctx.table === 'payments' && ctx.op === 'select', () => ({ data: payments.slice(), error: null }))
  sb.when((ctx) => ctx.table === 'payments' && ctx.op === 'insert', (ctx) => {
    payments.push({ ...ctx.payload, id: 'pay-new', status: 'succeeded' })
    return { data: { id: 'pay-new' }, error: null }
  })
  const body = { profileId: RIDER_ID, amountCents: 1250, confirmed: true, requestId: REQUEST_ID }
  const first = await run({ action: 'refund', stripe, stripeAvailable: true, sb, body })
  const second = await run({ action: 'refund', stripe, stripeAvailable: true, sb, body })
  assert.equal(first.body.duplicate, false)
  assert.equal(second.status, 200)
  assert.equal(second.body.duplicate, true)
  assert.equal(calls.length, 1)
})

test('rider and driver screens do not mount the admin money panel', () => {
  const files = [
    'src/screens/RiderHome.jsx',
    'src/screens/DriverHome.jsx',
    'src/screens/AccountScreenImpl.jsx',
    'src/screens/IncentivesAdmin.jsx',
    'src/screens/DriverEarnings.jsx',
  ]
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.equal(text.includes('AdminMoneyPanel'), false, file)
    assert.equal(text.includes('confirmAdminMoney'), false, file)
    assert.equal(text.includes('previewAdminMoney'), false, file)
  }
})
