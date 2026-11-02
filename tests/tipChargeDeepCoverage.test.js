import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chargeSavedTip,
  tipChargeKey,
} from '../server/tipCharge.js'

/* ── helpers ─────────────────────────────────────────────────────── */

function memoryDb(seed = {}) {
  const tables = {
    profiles: [...(seed.profiles || [])],
    payments: [...(seed.payments || [])],
  }
  function from(table) {
    if (!tables[table]) tables[table] = []
    const rows = tables[table]
    const state = { op: 'select', filters: [], payload: null }

    function matches(row) {
      return state.filters.every(([col, val]) => row[col] === val)
    }
    function run(one) {
      if (state.op === 'insert') {
        const row = { id: `${table}_${rows.length + 1}`, ...(state.payload || {}) }
        rows.push(row)
        return { data: one ? { ...row } : [{ ...row }], error: null }
      }
      const found = rows.filter(matches)
      if (one) return { data: found[0] ? { ...found[0] } : null, error: null }
      return { data: found.map((r) => ({ ...r })), error: null }
    }
    const api = {
      select() { return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      eq(col, val) { state.filters.push([col, val]); return api },
      maybeSingle() { return Promise.resolve(run(true)) },
      single() { return Promise.resolve(run(true)) },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject) },
    }
    return api
  }
  return { from, _t: tables }
}

function stubStripe(status = 'succeeded') {
  const calls = []
  return {
    calls,
    paymentIntents: {
      async create(params, opts) {
        calls.push({ params, opts })
        return { id: 'pi_tip_test', status }
      },
    },
  }
}

/* ── tipChargeKey ─────────────────────────────────────────────────── */

test('tipChargeKey: returns deterministic key from tripId', () => {
  assert.equal(tipChargeKey('t_abc'), 'tip:t_abc')
  assert.equal(tipChargeKey(''), 'tip:')
})

/* ── chargeSavedTip: zero/missing amount is skipped ──────────────── */

test('chargeSavedTip: skips when amountCents is zero', async () => {
  const sb = memoryDb()
  const res = await chargeSavedTip({
    sb,
    trip: { id: 'trip_1' },
    amountCents: 0,
    riderId: 'rider_1',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'skipped')
  assert.equal(res.tipCents, 0)
})

test('chargeSavedTip: skips when amountCents is negative', async () => {
  const res = await chargeSavedTip({
    sb: memoryDb(),
    trip: { id: 'trip_2' },
    amountCents: -500,
    riderId: 'rider_1',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'skipped')
})

test('chargeSavedTip: skips when trip is null', async () => {
  const res = await chargeSavedTip({
    sb: memoryDb(),
    trip: null,
    amountCents: 300,
    riderId: 'rider_1',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'skipped')
})

test('chargeSavedTip: skips when riderId is missing', async () => {
  const res = await chargeSavedTip({
    sb: memoryDb(),
    trip: { id: 'trip_3' },
    amountCents: 300,
    riderId: null,
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'skipped')
})

/* ── chargeSavedTip: no saved card ───────────────────────────────── */

test('chargeSavedTip: returns no_card when rider has no payment method', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_nocard', stripe_customer_id: 'cus_1', stripe_default_pm_id: null }],
  })
  const res = await chargeSavedTip({
    sb,
    trip: { id: 'trip_4' },
    amountCents: 500,
    riderId: 'rider_nocard',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'no_card')
})

test('chargeSavedTip: returns no_card when rider has no customer id', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_nocust', stripe_customer_id: null, stripe_default_pm_id: 'pm_1' }],
  })
  const res = await chargeSavedTip({
    sb,
    trip: { id: 'trip_5' },
    amountCents: 500,
    riderId: 'rider_nocust',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'no_card')
})

test('chargeSavedTip: returns no_card when profile not found', async () => {
  const sb = memoryDb({ profiles: [] })
  const res = await chargeSavedTip({
    sb,
    trip: { id: 'trip_6' },
    amountCents: 500,
    riderId: 'rider_missing',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'no_card')
})

/* ── chargeSavedTip: idempotent duplicate tip ────────────────────── */

test('chargeSavedTip: returns duplicate when a succeeded tip already exists', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_dup', stripe_customer_id: 'cus_dup', stripe_default_pm_id: 'pm_dup' }],
    payments: [{
      trip_id: 'trip_dup',
      kind: 'tip',
      status: 'succeeded',
      amount_cents: 350,
      stripe_payment_intent_id: 'pi_dup_prior',
      idempotency_key: null,
    }],
  })
  const res = await chargeSavedTip({
    sb,
    trip: { id: 'trip_dup' },
    amountCents: 350,
    riderId: 'rider_dup',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, true)
  assert.equal(res.duplicate, true)
  assert.equal(res.chargeStatus, 'charged')
  assert.equal(res.tipCents, 350)
  assert.equal(res.paymentIntentId, 'pi_dup_prior')
})

/* ── chargeSavedTip: successful charge with stub Stripe ──────────── */

test('chargeSavedTip: charges rider with stub Stripe processor', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_ok', stripe_customer_id: 'cus_ok', stripe_default_pm_id: 'pm_ok' }],
    payments: [],
  })
  const stripe = stubStripe('succeeded')
  const res = await chargeSavedTip({
    sb,
    cardClient: stripe,
    trip: { id: 'trip_ok' },
    amountCents: 475,
    riderId: 'rider_ok',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, true)
  assert.equal(res.chargeStatus, 'charged')
  assert.equal(res.tipCents, 475)
  assert.equal(res.paymentIntentId, 'pi_tip_test')
  // Stripe call made with correct params
  assert.equal(stripe.calls.length, 1)
  assert.equal(stripe.calls[0].params.amount, 475)
  assert.equal(stripe.calls[0].params.off_session, true)
  assert.equal(stripe.calls[0].params.confirm, true)
  assert.equal(stripe.calls[0].params.customer, 'cus_ok')
  assert.equal(stripe.calls[0].params.payment_method, 'pm_ok')
  assert.equal(stripe.calls[0].opts.idempotencyKey, 'tip:trip_ok')
  // Payment row recorded
  assert.equal(sb._t.payments.length, 1)
  assert.equal(sb._t.payments[0].kind, 'tip')
  assert.equal(sb._t.payments[0].status, 'succeeded')
})

/* ── chargeSavedTip: pending status ──────────────────────────────── */

test('chargeSavedTip: returns pending when Stripe PI is not succeeded', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_pend', stripe_customer_id: 'cus_pend', stripe_default_pm_id: 'pm_pend' }],
    payments: [],
  })
  const stripe = stubStripe('requires_action')
  const res = await chargeSavedTip({
    sb,
    cardClient: stripe,
    trip: { id: 'trip_pend' },
    amountCents: 200,
    riderId: 'rider_pend',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'pending')
  assert.equal(res.tipCents, 0)
  assert.equal(res.paymentIntentId, 'pi_tip_test')
})

/* ── chargeSavedTip: declined card ───────────────────────────────── */

test('chargeSavedTip: returns declined when Stripe throws', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_dec', stripe_customer_id: 'cus_dec', stripe_default_pm_id: 'pm_dec' }],
    payments: [],
  })
  const stripe = {
    paymentIntents: {
      async create() { throw new Error('card_declined') },
    },
  }
  const res = await chargeSavedTip({
    sb,
    cardClient: stripe,
    trip: { id: 'trip_dec' },
    amountCents: 300,
    riderId: 'rider_dec',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'declined')
})

/* ── chargeSavedTip: no Stripe client ────────────────────────────── */

test('chargeSavedTip: returns unavailable when no Stripe processor', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_nostripe', stripe_customer_id: 'cus_ns', stripe_default_pm_id: 'pm_ns' }],
    payments: [],
  })
  const res = await chargeSavedTip({
    sb,
    cardClient: null,
    trip: { id: 'trip_ns' },
    amountCents: 500,
    riderId: 'rider_nostripe',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'unavailable')
})

/* ── chargeSavedTip: amount rounds and floors ────────────────────── */

test('chargeSavedTip: rounds fractional amountCents correctly', async () => {
  const sb = memoryDb({
    profiles: [{ id: 'rider_frac', stripe_customer_id: 'cus_f', stripe_default_pm_id: 'pm_f' }],
    payments: [],
  })
  const stripe = stubStripe('succeeded')
  const res = await chargeSavedTip({
    sb,
    cardClient: stripe,
    trip: { id: 'trip_frac' },
    amountCents: 299.7,
    riderId: 'rider_frac',
  })
  assert.equal(res.tipCents, 300)
  assert.equal(stripe.calls[0].params.amount, 300)
})

/* ── chargeSavedTip: NaN amount is skipped ───────────────────────── */

test('chargeSavedTip: skips when amountCents is NaN', async () => {
  const res = await chargeSavedTip({
    sb: memoryDb(),
    trip: { id: 'trip_nan' },
    amountCents: NaN,
    riderId: 'rider_1',
  })
  assert.equal(res.ok, true)
  assert.equal(res.charged, false)
  assert.equal(res.chargeStatus, 'skipped')
})
