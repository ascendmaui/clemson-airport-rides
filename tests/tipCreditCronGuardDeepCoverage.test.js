import test from 'node:test'
import assert from 'node:assert/strict'
import { chargeSavedTip, tipChargeKey } from '../server/tipCharge.js'
import { debitStoredRideCredits, rideCreditKey } from '../server/rideCreditSettle.js'
import {
  cronEndpointsDisabled,
  stagingDryRunAllowed,
  stagingCronBlock,
} from '../server/cronGuard.js'

// Test placeholders only. No real Stripe keys, customers, or cards.
const RIDER = 'rider_tip_test'
const TRIP = { id: 'trip_tip_test' }

function memoryDb(seed = {}, { failSelect = {}, failInsert = null, throwOn = {} } = {}) {
  const tables = {
    profiles: [...(seed.profiles || [])],
    payments: [...(seed.payments || [])],
  }
  const calls = { inserts: [] }
  function from(table) {
    if (!tables[table]) tables[table] = []
    const rows = tables[table]
    const filters = []
    const q = {
      select() {
        if (throwOn[table]) throw new Error(`boom ${table}`)
        return q
      },
      eq(col, val) { filters.push([col, val]); return q },
      maybeSingle() {
        if (failSelect[table]) return Promise.resolve({ data: null, error: { message: 'select failed' } })
        const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v)) || null
        return Promise.resolve({ data: hit, error: null })
      },
      then(resolve, reject) {
        if (failSelect[table]) return Promise.resolve({ data: null, error: { message: 'select failed' } }).then(resolve, reject)
        const hits = rows.filter((r) => filters.every(([c, v]) => r[c] === v))
        return Promise.resolve({ data: hits, error: null }).then(resolve, reject)
      },
      insert(row) {
        calls.inserts.push({ table, row })
        if (failInsert) return Promise.resolve({ data: null, error: { message: failInsert } })
        rows.push(row)
        return Promise.resolve({ data: row, error: null })
      },
    }
    return q
  }
  return { from, tables, calls }
}

function cardProfile(extra = {}) {
  return {
    id: RIDER,
    stripe_customer_id: 'cus_placeholder',
    stripe_default_pm_id: 'pm_placeholder',
    ...extra,
  }
}

function fakeStripe(status = 'succeeded', { throws = false } = {}) {
  const created = []
  return {
    created,
    paymentIntents: {
      async create(params, opts) {
        created.push({ params, opts })
        if (throws) throw new Error('card_declined')
        return { id: `pi_placeholder_${created.length}`, status }
      },
    },
  }
}

// ---------- tipCharge ----------

test('tipChargeKey is stable per trip', () => {
  assert.equal(tipChargeKey('abc'), 'tip:abc')
  assert.equal(tipChargeKey('abc'), tipChargeKey('abc'))
})

test('chargeSavedTip skips zero, negative, NaN amounts and missing trip or rider', async () => {
  const sb = memoryDb({ profiles: [cardProfile()] })
  const stripe = fakeStripe()
  for (const args of [
    { amountCents: 0, trip: TRIP, riderId: RIDER },
    { amountCents: -500, trip: TRIP, riderId: RIDER },
    { amountCents: 'abc', trip: TRIP, riderId: RIDER },
    { amountCents: 0.4, trip: TRIP, riderId: RIDER },
    { amountCents: 500, trip: null, riderId: RIDER },
    { amountCents: 500, trip: {}, riderId: RIDER },
    { amountCents: 500, trip: TRIP, riderId: '' },
  ]) {
    const out = await chargeSavedTip({ sb, cardClient: stripe, ...args })
    assert.deepEqual(out, { ok: true, charged: false, chargeStatus: 'skipped', tipCents: 0 })
  }
  assert.equal(stripe.created.length, 0)
})

test('chargeSavedTip reports no_card when the profile has no customer or payment method', async () => {
  for (const profile of [
    null,
    cardProfile({ stripe_default_pm_id: null }),
    cardProfile({ stripe_customer_id: null }),
  ]) {
    const sb = memoryDb({ profiles: profile ? [profile] : [] })
    const stripe = fakeStripe()
    const out = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })
    assert.equal(out.chargeStatus, 'no_card')
    assert.equal(out.charged, false)
    assert.equal(stripe.created.length, 0)
  }
})

test('chargeSavedTip treats a profile read error or throw as no_card', async () => {
  const stripe = fakeStripe()
  const errored = memoryDb({ profiles: [cardProfile()] }, { failSelect: { profiles: true } })
  assert.equal((await chargeSavedTip({ sb: errored, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })).chargeStatus, 'no_card')
  const thrown = memoryDb({ profiles: [cardProfile()] }, { throwOn: { profiles: true } })
  assert.equal((await chargeSavedTip({ sb: thrown, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })).chargeStatus, 'no_card')
  assert.equal(stripe.created.length, 0)
})

test('chargeSavedTip charges off-session with the trip idempotency key and records one payment row', async () => {
  const sb = memoryDb({ profiles: [cardProfile()] })
  const stripe = fakeStripe('succeeded')
  const out = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 499.6, riderId: RIDER })
  assert.equal(out.charged, true)
  assert.equal(out.chargeStatus, 'charged')
  assert.equal(out.tipCents, 500)
  assert.equal(stripe.created.length, 1)
  const { params, opts } = stripe.created[0]
  assert.equal(params.amount, 500)
  assert.equal(params.currency, 'usd')
  assert.equal(params.customer, 'cus_placeholder')
  assert.equal(params.payment_method, 'pm_placeholder')
  assert.equal(params.off_session, true)
  assert.equal(params.confirm, true)
  assert.equal(params.metadata.kind, 'tip')
  assert.equal(params.metadata.tipCents, '500')
  assert.equal(opts.idempotencyKey, 'tip:trip_tip_test')
  assert.equal(sb.calls.inserts.length, 1)
  assert.equal(sb.calls.inserts[0].row.kind, 'tip')
  assert.equal(sb.calls.inserts[0].row.amount_cents, 500)
  assert.equal(sb.calls.inserts[0].row.idempotency_key, 'tip:trip_tip_test')
})

test('chargeSavedTip returns the prior succeeded tip instead of charging twice', async () => {
  const sb = memoryDb({ profiles: [cardProfile()] })
  const stripe = fakeStripe('succeeded')
  await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 500, riderId: RIDER })
  const second = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 900, riderId: RIDER })
  assert.equal(second.duplicate, true)
  assert.equal(second.charged, true)
  assert.equal(second.tipCents, 500)
  assert.equal(second.paymentIntentId, 'pi_placeholder_1')
  assert.equal(stripe.created.length, 1)
})

test('chargeSavedTip ignores non-tip, non-succeeded, or other-key payment rows on the trip', async () => {
  const sb = memoryDb({
    profiles: [cardProfile()],
    payments: [
      { trip_id: TRIP.id, kind: 'fare', status: 'succeeded', amount_cents: 2000 },
      { trip_id: TRIP.id, kind: 'tip', status: 'failed', amount_cents: 500 },
      { trip_id: TRIP.id, kind: 'tip', status: 'succeeded', amount_cents: 500, idempotency_key: 'tip:other' },
    ],
  })
  const stripe = fakeStripe('succeeded')
  const out = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })
  assert.equal(out.duplicate, undefined)
  assert.equal(stripe.created.length, 1)
})

test('chargeSavedTip reports unavailable without a processor that can create intents', async () => {
  const sb = memoryDb({ profiles: [cardProfile()] })
  const out = await chargeSavedTip({ sb, cardClient: {}, trip: TRIP, amountCents: 300, riderId: RIDER })
  assert.deepEqual(out, { ok: true, charged: false, chargeStatus: 'unavailable', tipCents: 0 })
  assert.equal(sb.calls.inserts.length, 0)
})

test('chargeSavedTip reports pending for a non-succeeded intent and records nothing', async () => {
  const sb = memoryDb({ profiles: [cardProfile()] })
  const stripe = fakeStripe('requires_action')
  const out = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })
  assert.equal(out.chargeStatus, 'pending')
  assert.equal(out.charged, false)
  assert.equal(out.tipCents, 0)
  assert.equal(out.paymentIntentId, 'pi_placeholder_1')
  assert.equal(sb.calls.inserts.length, 0)
})

test('chargeSavedTip resolves declined (never throws) when the card is declined', async () => {
  const sb = memoryDb({ profiles: [cardProfile()] })
  const stripe = fakeStripe('succeeded', { throws: true })
  const out = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })
  assert.deepEqual(out, { ok: true, charged: false, chargeStatus: 'declined', tipCents: 0 })
  assert.equal(sb.calls.inserts.length, 0)
})

test('chargeSavedTip still reports charged when recording the payment row fails after capture', async () => {
  for (const msg of ['duplicate key value', 'connection reset']) {
    const sb = memoryDb({ profiles: [cardProfile()] }, { failInsert: msg })
    const stripe = fakeStripe('succeeded')
    const out = await chargeSavedTip({ sb, cardClient: stripe, trip: TRIP, amountCents: 300, riderId: RIDER })
    assert.equal(out.charged, true)
    assert.equal(out.tipCents, 300)
  }
})

// ---------- rideCreditSettle ----------

function fakeCreditStore(result) {
  const calls = []
  return {
    calls,
    async applyCredits(riderId, delta, meta) {
      calls.push({ riderId, delta, meta })
      return typeof result === 'function' ? result(calls.length) : result
    },
  }
}

test('rideCreditKey is stable per trip', () => {
  assert.equal(rideCreditKey('t1'), 'ride_credits:t1')
})

test('debitStoredRideCredits is a no-op for zero, bad amounts, or missing ids', async () => {
  const store = fakeCreditStore({ ok: true, balanceCents: 0 })
  for (const args of [
    { amountCents: 0, riderId: 'r', tripId: 't' },
    { amountCents: -10, riderId: 'r', tripId: 't' },
    { amountCents: 'x', riderId: 'r', tripId: 't' },
    { amountCents: 100, riderId: '', tripId: 't' },
    { amountCents: 100, riderId: 'r', tripId: null },
  ]) {
    const out = await debitStoredRideCredits({ store, ...args })
    assert.deepEqual(out, { ok: true, debitedCents: 0, duplicate: false, balanceCents: 0 })
  }
  assert.equal(store.calls.length, 0)
})

test('debitStoredRideCredits debits a negative rounded amount with the trip key', async () => {
  const store = fakeCreditStore({ ok: true, balanceCents: 1500 })
  const out = await debitStoredRideCredits({ store, riderId: 'r1', tripId: 't1', amountCents: 1249.5 })
  assert.deepEqual(out, { ok: true, duplicate: false, balanceCents: 1500, debitedCents: 1250 })
  assert.deepEqual(store.calls[0], {
    riderId: 'r1',
    delta: -1250,
    meta: { kind: 'ride_redemption', tripId: 't1', idempotencyKey: 'ride_credits:t1' },
  })
})

test('debitStoredRideCredits surfaces duplicate settles from the ledger', async () => {
  const store = fakeCreditStore({ ok: true, duplicate: true, balanceCents: 200 })
  const out = await debitStoredRideCredits({ store, riderId: 'r1', tripId: 't1', amountCents: 500 })
  assert.equal(out.duplicate, true)
  assert.equal(out.balanceCents, 200)
})

test('debitStoredRideCredits reports insufficient credits without debiting', async () => {
  const store = fakeCreditStore({ ok: false, code: 'insufficient_credits', balanceCents: 300.2 })
  const out = await debitStoredRideCredits({ store, riderId: 'r1', tripId: 't1', amountCents: 500 })
  assert.deepEqual(out, { ok: false, code: 'insufficient_credits', balanceCents: 300, debitedCents: 0 })
})

test('debitStoredRideCredits defaults the failure code and clamps negative balances', async () => {
  for (const result of [null, undefined, { ok: false, balanceCents: -50 }]) {
    const store = fakeCreditStore(result)
    const out = await debitStoredRideCredits({ store, riderId: 'r1', tripId: 't1', amountCents: 500 })
    assert.equal(out.ok, false)
    assert.equal(out.code, 'credits_unavailable')
    assert.equal(out.balanceCents, 0)
    assert.equal(out.debitedCents, 0)
  }
})

// ---------- cronGuard ----------

test('cron flags accept only 1/true (any case, trimmed)', () => {
  for (const v of ['1', 'true', 'TRUE', ' True ', 1, true]) {
    assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: v }), true, `on: ${v}`)
    assert.equal(stagingDryRunAllowed({ ALLOW_STAGING_DRY_RUN: v }), true, `on: ${v}`)
  }
  for (const v of [undefined, null, '', '0', 'false', 'yes', 'on', '2', 0, false]) {
    assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: v }), false, `off: ${v}`)
    assert.equal(stagingDryRunAllowed({ ALLOW_STAGING_DRY_RUN: v }), false, `off: ${v}`)
  }
  assert.equal(cronEndpointsDisabled(null), false)
  assert.equal(stagingDryRunAllowed(undefined === undefined ? {} : null), false)
})

test('stagingCronBlock lets every request through when cron endpoints are enabled', () => {
  assert.equal(stagingCronBlock({}), null)
  assert.equal(stagingCronBlock({}, { dryRun: true }), null)
  assert.equal(stagingCronBlock({ ALLOW_STAGING_DRY_RUN: '1' }), null)
})

test('stagingCronBlock refuses real runs on a disabled host even when dry-run is allowed', () => {
  const env = { DISABLE_CRON_ENDPOINTS: '1', ALLOW_STAGING_DRY_RUN: '1' }
  assert.deepEqual(stagingCronBlock(env), {
    status: 403,
    body: { error: 'Cron endpoints are disabled on this host' },
  })
  assert.deepEqual(stagingCronBlock(env, { dryRun: false }), stagingCronBlock(env))
})

test('stagingCronBlock allows dry-run on a disabled host only with ALLOW_STAGING_DRY_RUN', () => {
  assert.equal(stagingCronBlock({ DISABLE_CRON_ENDPOINTS: 'true', ALLOW_STAGING_DRY_RUN: 'true' }, { dryRun: true }), null)
  assert.deepEqual(stagingCronBlock({ DISABLE_CRON_ENDPOINTS: 'true' }, { dryRun: true }), {
    status: 403,
    body: { error: 'Dry-run is disabled on this host' },
  })
})
