import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { capturePlan, fareAuthorizationCents, shouldRetryAuthorization } from '../shared/fareAuthorization.js'
import {
  authorizeRideRequest,
  placeFareAuthorization,
  releaseOpenFareHold,
  settleFareHold,
  syncBoostAuthorization,
} from './fareAuthorization.js'

function memoryDb(seed = {}) {
  const tables = {
    profiles: [...(seed.profiles || [])],
    trips: [...(seed.trips || [])],
    payments: [...(seed.payments || [])],
  }

  function from(table) {
    if (!tables[table]) tables[table] = []
    const rows = tables[table]
    const state = { op: 'select', filters: [], payload: null }

    function run(one) {
      const matches = (row) => state.filters.every(([col, val]) => row[col] === val)
      if (state.op === 'insert') {
        const row = { id: state.payload.id || `${table}_${rows.length + 1}`, ...state.payload }
        rows.push(row)
        return { data: one ? { ...row } : [{ ...row }], error: null }
      }
      if (state.op === 'update') {
        const matched = rows.filter(matches)
        for (const row of matched) Object.assign(row, state.payload)
        return { data: matched.map((row) => ({ ...row })), error: null }
      }
      const found = rows.filter(matches)
      if (one) return { data: found[0] ? { ...found[0] } : null, error: null }
      return { data: found.map((row) => ({ ...row })), error: null }
    }

    const api = {
      select() { return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      eq(col, val) { state.filters.push([col, val]); return api },
      maybeSingle() { return Promise.resolve(run(true)) },
      single() { return Promise.resolve(run(true)) },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject) },
    }
    return api
  }

  return { tables, from }
}

function decline(code, id) {
  const err = new Error(code)
  err.code = code
  err.decline_code = code === 'insufficient_funds' ? 'insufficient_funds' : 'generic_decline'
  err.payment_intent = { id, status: 'requires_payment_method' }
  return err
}

function scriptedStripe({ creates = [], methods = [], capture, increment, retrieve } = {}) {
  const calls = []
  let cursor = 0
  return {
    calls,
    paymentMethods: {
      async list() {
        return { data: methods.map((id) => ({ id })) }
      },
    },
    paymentIntents: {
      async create(params, options) {
        calls.push({ op: 'create', params, options })
        const step = creates[cursor] || creates[creates.length - 1]
        cursor += 1
        if (step?.error) throw step.error
        return {
          id: step?.id || `pi_${cursor}`,
          status: step?.status || 'requires_capture',
          amount: params.amount,
          amount_received: step?.status === 'succeeded' ? params.amount : 0,
        }
      },
      async cancel(id) {
        calls.push({ op: 'cancel', id })
        return { id, status: 'canceled' }
      },
      async retrieve(id) {
        calls.push({ op: 'retrieve', id })
        if (retrieve) return retrieve(id)
        return { id, status: 'requires_capture', amount: 12000 }
      },
      async capture(id, params, options) {
        calls.push({ op: 'capture', id, params, options })
        if (!capture) return { id, status: 'succeeded', amount_received: params.amount_to_capture }
        const result = typeof capture === 'function' ? capture(id, params, options) : capture
        if (result?.error) throw result.error
        return result
      },
      async incrementAuthorization(id, params, options) {
        calls.push({ op: 'increment', id, params, options })
        if (!increment) return { id, status: 'requires_capture', amount: params.amount }
        if (increment.error) throw increment.error
        return increment
      },
    },
  }
}

test('authorization is the estimate plus 20 percent, and at least $2', () => {
  assert.deepEqual(fareAuthorizationCents(10000), {
    estimatedFareCents: 10000,
    bufferCents: 2000,
    authorizationCents: 12000,
  })
  assert.deepEqual(fareAuthorizationCents(500), {
    estimatedFareCents: 500,
    bufferCents: 200,
    authorizationCents: 700,
  })
  assert.deepEqual(fareAuthorizationCents(0), {
    estimatedFareCents: 0,
    bufferCents: 0,
    authorizationCents: 0,
  })
})

test('capture plan partial-captures inside the hold, increments above it, and waives under $0.50', () => {
  assert.deepEqual(capturePlan({ authorizationCents: 12000, finalFareCents: 9000 }), {
    action: 'capture',
    captureCents: 9000,
    overageCents: 0,
    releaseCents: 3000,
  })
  assert.equal(capturePlan({ authorizationCents: 12000, finalFareCents: 15000 }).action, 'increment')
  assert.equal(capturePlan({ authorizationCents: 12000, finalFareCents: 15000 }).overageCents, 3000)
  assert.equal(capturePlan({ authorizationCents: 12000, finalFareCents: 40 }).action, 'waive')
  assert.equal(capturePlan({ authorizationCents: 12000, finalFareCents: 0 }).action, 'cancel')
  assert.equal(shouldRetryAuthorization('card_declined'), true)
  assert.equal(shouldRetryAuthorization('insufficient_funds'), true)
  assert.equal(shouldRetryAuthorization('charge_failed'), true)
  assert.equal(shouldRetryAuthorization('expired_card'), false)
  assert.equal(shouldRetryAuthorization('authentication_required'), false)
})

test('a decline is retried once on the same card', async () => {
  const stripe = scriptedStripe({
    creates: [
      { error: decline('card_declined', 'pi_fail') },
      { id: 'pi_ok', status: 'requires_capture' },
    ],
  })
  const placed = await placeFareAuthorization({
    stripe,
    tripId: 'trip_retry',
    riderId: 'rider_1',
    customerId: 'cus_1',
    paymentMethodId: 'pm_default',
    backupPaymentMethodIds: [],
    estimatedFareCents: 10000,
  })
  assert.equal(placed.ok, true)
  assert.equal(placed.authorization.paymentIntentId, 'pi_ok')
  assert.equal(placed.authorization.authorizationCents, 12000)
  assert.equal(placed.attempts.length, 2)
  assert.equal(placed.attempts[1].suffix, 'retry')
  assert.equal(stripe.calls.filter((call) => call.op === 'create').length, 2)
})

test('a second decline tries a backup card', async () => {
  const stripe = scriptedStripe({
    creates: [
      { error: decline('insufficient_funds', 'pi_a') },
      { error: decline('insufficient_funds', 'pi_b') },
      { id: 'pi_backup', status: 'requires_capture' },
    ],
    methods: ['pm_default', 'pm_backup'],
  })
  const placed = await placeFareAuthorization({
    stripe,
    tripId: 'trip_backup',
    riderId: 'rider_1',
    customerId: 'cus_1',
    paymentMethodId: 'pm_default',
    estimatedFareCents: 4000,
  })
  assert.equal(placed.ok, true)
  assert.equal(placed.authorization.paymentMethodId, 'pm_backup')
  assert.equal(placed.authorization.backupCard, true)
  assert.equal(placed.authorizationCents, 4800)
})

test('failed authorization parks the estimate and does not set a payment hold', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{ id: 'trip_park', rider_id: 'rider_1', fare_cents: 5000, metadata: {} }],
  })
  const stripe = scriptedStripe({
    creates: [
      { error: decline('card_declined', 'pi_1') },
      { error: decline('card_declined', 'pi_2') },
      { error: decline('card_declined', 'pi_3') },
    ],
    methods: ['pm_backup'],
  })
  const placed = await authorizeRideRequest({
    sb: db,
    stripe,
    trip: db.tables.trips[0],
    riderId: 'rider_1',
    estimatedFareCents: 5000,
  })
  assert.equal(placed.ok, false)
  assert.equal(placed.parked, true)
  assert.equal(placed.outstanding.amountCents, 5000)
  assert.equal(db.tables.trips[0].metadata.outstanding_balance.reason, 'authorization_failed')
  assert.equal(db.tables.trips[0].metadata.payment_hold, undefined)
  assert.equal(db.tables.payments.length, 0)
})

test('missing Stripe skips the hold and writes nothing', async () => {
  const db = memoryDb({
    trips: [{ id: 'trip_skip', rider_id: 'rider_1', fare_cents: 5000, metadata: {} }],
  })
  const placed = await authorizeRideRequest({
    sb: db,
    stripe: {},
    trip: db.tables.trips[0],
    riderId: 'rider_1',
    estimatedFareCents: 5000,
  })
  assert.equal(placed.skipped, true)
  assert.equal(placed.reason, 'stripe_not_configured')
  assert.equal(db.tables.trips[0].metadata.fare_authorization, undefined)
  assert.equal(db.tables.payments.length, 0)
})

test('trip end captures the final fare inside the hold', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{
      id: 'trip_cap',
      rider_id: 'rider_1',
      fare_cents: 9000,
      metadata: {
        fare_authorization: {
          status: 'requires_capture',
          paymentIntentId: 'pi_hold',
          authorizationCents: 12000,
          paymentMethodId: 'pm_default',
        },
      },
    }],
  })
  const stripe = scriptedStripe({})
  const settled = await settleFareHold({
    sb: db,
    stripe,
    trip: db.tables.trips[0],
    finalFareCents: 9000,
  })
  assert.equal(settled.ok, true)
  assert.equal(settled.amountCents, 9000)
  assert.equal(db.tables.trips[0].metadata.fare_authorization.status, 'captured')
  assert.equal(db.tables.trips[0].metadata.fare_paid_cents, 9000)
  assert.equal(db.tables.payments[0].status, 'succeeded')
  assert.equal(db.tables.payments[0].amount_cents, 9000)
})

test('a final fare above the hold increments the authorization', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{
      id: 'trip_inc',
      rider_id: 'rider_1',
      metadata: {
        fare_authorization: {
          status: 'requires_capture',
          paymentIntentId: 'pi_hold',
          authorizationCents: 12000,
          paymentMethodId: 'pm_default',
        },
      },
    }],
  })
  const stripe = scriptedStripe({
    increment: { id: 'pi_hold', status: 'requires_capture', amount: 15000 },
  })
  const settled = await settleFareHold({
    sb: db,
    stripe,
    trip: db.tables.trips[0],
    finalFareCents: 15000,
  })
  assert.equal(settled.ok, true)
  assert.equal(settled.amountCents, 15000)
  assert.equal(stripe.calls.some((call) => call.op === 'increment'), true)
  const capture = stripe.calls.find((call) => call.op === 'capture')
  assert.equal(capture.params.amount_to_capture, 15000)
})

test('a capture decline retries and then charges a backup card', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{
      id: 'trip_cap_retry',
      rider_id: 'rider_1',
      metadata: {
        fare_authorization: {
          status: 'requires_capture',
          paymentIntentId: 'pi_hold',
          authorizationCents: 7000,
          paymentMethodId: 'pm_default',
        },
      },
    }],
  })
  const stripe = scriptedStripe({
    methods: ['pm_backup'],
    capture() {
      return { error: decline('card_declined', 'pi_hold') }
    },
    creates: [
      { error: decline('card_declined', 'pi_x') },
      { error: decline('card_declined', 'pi_y') },
      { id: 'pi_replace', status: 'succeeded' },
    ],
  })
  const settled = await settleFareHold({
    sb: db,
    stripe,
    trip: db.tables.trips[0],
    finalFareCents: 5000,
  })
  assert.equal(settled.ok, true)
  assert.equal(settled.paymentIntentId, 'pi_replace')
  assert.equal(settled.backupCard, true)
  assert.equal(db.tables.trips[0].metadata.payment_hold, undefined)
})

test('a capture that still fails parks the outstanding balance and blocks completion', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{
      id: 'trip_due',
      rider_id: 'rider_1',
      metadata: {
        fare_authorization: {
          status: 'requires_capture',
          paymentIntentId: 'pi_hold',
          authorizationCents: 7000,
          paymentMethodId: 'pm_default',
        },
      },
    }],
  })
  const stripe = scriptedStripe({
    capture() {
      return { error: decline('card_declined', 'pi_hold') }
    },
    creates: [
      { error: decline('card_declined', 'pi_x') },
      { error: decline('card_declined', 'pi_y') },
    ],
  })
  const settled = await settleFareHold({
    sb: db,
    stripe,
    trip: db.tables.trips[0],
    finalFareCents: 6400,
  })
  assert.equal(settled.ok, false)
  assert.equal(settled.parked, true)
  assert.equal(settled.outstanding.amountCents, 6400)
  assert.equal(db.tables.trips[0].metadata.payment_hold.status, 'payment_required')
  assert.equal(db.tables.trips[0].metadata.outstanding_balance.reason, 'capture_failed')
})

test('ride credits cancel the hold instead of capturing it', async () => {
  const db = memoryDb({
    trips: [{
      id: 'trip_credits',
      rider_id: 'rider_1',
      metadata: {
        billing_choice: 'credits',
        fare_authorization: {
          status: 'requires_capture',
          paymentIntentId: 'pi_hold',
          authorizationCents: 7000,
        },
      },
    }],
  })
  const stripe = scriptedStripe({})
  const settled = await settleFareHold({
    sb: db,
    stripe,
    trip: db.tables.trips[0],
    finalFareCents: 5000,
  })
  assert.equal(settled, null)
  assert.equal(db.tables.trips[0].metadata.fare_authorization.status, 'canceled')
  assert.equal(stripe.calls.some((call) => call.op === 'cancel'), true)
  assert.equal(stripe.calls.some((call) => call.op === 'capture'), false)
})

test('the deposit retirement migration clears unpaid open holds and keeps the accept trigger', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261005190000_retire_airport_deposit.sql', import.meta.url), 'utf8')
  assert.match(sql, /deposit_cents = 0/)
  assert.match(sql, /deposit_retired/)
  assert.match(sql, /searching/)
  assert.match(sql, /succeeded/)
  assert.doesNotMatch(sql, /DROP TRIGGER/i)
  assert.match(sql, /expir/i)
})

test('releaseOpenFareHold handles no open hold, unconfigured Stripe, failures, and clean cancellation', async () => {
  // No open hold
  assert.deepEqual(await releaseOpenFareHold({ trip: { id: 't_none', metadata: {} } }), {
    ok: true,
    skipped: true,
    reason: 'no_open_hold',
  })

  // Stripe not configured
  const tripWithHold = {
    id: 't_hold',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_123',
      },
    },
  }
  const unconfigured = await releaseOpenFareHold({
    trip: tripWithHold,
    stripe: null,
  })
  assert.equal(unconfigured.ok, true)
  assert.equal(unconfigured.skipped, true)
  assert.equal(unconfigured.reason, 'stripe_not_configured')

  // Stripe cancel failure
  const failingStripe = {
    paymentIntents: {
      cancel: async () => { throw new Error('Stripe timeout') },
    },
  }
  const failed = await releaseOpenFareHold({
    trip: tripWithHold,
    stripe: failingStripe,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.reason, 'hold_release_failed')

  // Stripe cancel success
  let canceledId = null
  const successStripe = {
    paymentIntents: {
      cancel: async (id) => {
        canceledId = id
        return { id, status: 'canceled' }
      },
    },
  }
  const db = memoryDb({ trips: [tripWithHold] })
  const released = await releaseOpenFareHold({
    sb: db,
    trip: tripWithHold,
    stripe: successStripe,
    reason: 'rider_cancel',
  })
  assert.equal(released.ok, true)
  assert.equal(released.released, true)
  assert.equal(released.reason, 'rider_cancel')
  assert.equal(canceledId, 'pi_test_hold_123')
  assert.equal(db.tables.trips[0].metadata.fare_authorization.status, 'canceled')
  assert.equal(db.tables.trips[0].metadata.fare_authorization.reason, 'rider_cancel')
})

test('syncBoostAuthorization handles no hold, unconfigured stripe, already covered, increment, and reauth fallback', async () => {
  // No open hold
  assert.deepEqual(await syncBoostAuthorization({ trip: { id: 't_none' }, boostCents: 1000 }), {
    ok: true,
    skipped: true,
    reason: 'no_open_hold',
  })

  const tripWithHold = {
    id: 't_boost_hold',
    rider_id: 'rider_test_1',
    fare_cents: 6000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_boost_1',
        authorizationCents: 8400,
        estimatedFareCents: 6000,
        bufferCents: 2400,
        boostCents: 0,
      },
    },
  }

  // Stripe not configured
  assert.deepEqual(await syncBoostAuthorization({ trip: tripWithHold, stripe: null, boostCents: 2000 }), {
    ok: true,
    skipped: true,
    reason: 'stripe_not_configured',
  })

  // Hold already covers
  const stripe = scriptedStripe()
  const alreadyCovers = await syncBoostAuthorization({ trip: tripWithHold, stripe, boostCents: 0 })
  assert.equal(alreadyCovers.ok, true)
  assert.equal(alreadyCovers.skipped, true)
  assert.equal(alreadyCovers.reason, 'hold_already_covers')

  // Increment path
  const db = memoryDb({
    trips: [tripWithHold],
    profiles: [{ id: 'rider_test_1', stripe_customer_id: 'cus_test_1', stripe_default_pm_id: 'pm_test_1' }],
  })
  const incremented = await syncBoostAuthorization({
    sb: db,
    stripe,
    trip: tripWithHold,
    boostCents: 2000,
  })
  assert.equal(incremented.ok, true)
  assert.equal(incremented.method, 'increment')
  assert.equal(incremented.authorization.boostCents, 2000)
  assert.equal(db.tables.trips[0].metadata.fare_authorization.boostCents, 2000)

  // Reauth fallback when increment throws
  const failingIncrementStripe = {
    paymentIntents: {
      async cancel(id) { return { id, status: 'canceled' } },
      async incrementAuthorization() { throw new Error('Increment not supported') },
      async create(params) {
        return { id: 'pi_test_reauth', status: 'requires_capture', amount: params.amount }
      },
    },
    paymentMethods: {
      async list() { return { data: [] } },
    },
  }
  const reauthed = await syncBoostAuthorization({
    sb: db,
    stripe: failingIncrementStripe,
    trip: tripWithHold,
    boostCents: 3000,
  })
  assert.equal(reauthed.ok, true)
  assert.equal(reauthed.method, 'reauth')
  assert.equal(reauthed.authorization.paymentIntentId, 'pi_test_reauth')
  assert.equal(db.tables.trips[0].metadata.fare_authorization.paymentIntentId, 'pi_test_reauth')
})

test('settleFareHold handles already-succeeded hold, zero fare cancellation, and minimum charge waive', async () => {
  // Already succeeded PaymentIntent
  const succeededTrip = {
    id: 't_succ',
    rider_id: 'rider_test_1',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_succ',
        authorizationCents: 6000,
      },
    },
  }
  const db1 = memoryDb({ trips: [succeededTrip] })
  const stripe1 = scriptedStripe({
    retrieve: () => ({ id: 'pi_test_succ', status: 'succeeded', amount: 6000, amount_received: 6000 }),
  })
  const settled1 = await settleFareHold({
    sb: db1,
    stripe: stripe1,
    trip: succeededTrip,
    finalFareCents: 5000,
  })
  assert.equal(settled1.ok, true)
  assert.equal(settled1.method, 'card')
  assert.equal(settled1.status, 'succeeded')
  assert.equal(db1.tables.trips[0].metadata.fare_authorization.status, 'captured')

  // Zero fare ($0 due) cancels hold quietly
  const zeroTrip = {
    id: 't_zero',
    rider_id: 'rider_test_1',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_zero',
        authorizationCents: 5000,
      },
    },
  }
  const db2 = memoryDb({ trips: [zeroTrip] })
  const stripe2 = scriptedStripe()
  const settled2 = await settleFareHold({
    sb: db2,
    stripe: stripe2,
    trip: zeroTrip,
    finalFareCents: 0,
  })
  assert.equal(settled2.ok, true)
  assert.equal(settled2.method, 'none')
  assert.equal(settled2.reason, 'zero_due')
  assert.equal(db2.tables.trips[0].metadata.fare_authorization.status, 'canceled')

  // Waive under $0.50 (< MIN_CARD_CHARGE_CENTS = 50)
  const waiveTrip = {
    id: 't_waive',
    rider_id: 'rider_test_1',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_waive',
        authorizationCents: 5000,
      },
    },
  }
  const db3 = memoryDb({ trips: [waiveTrip] })
  const stripe3 = scriptedStripe()
  const settled3 = await settleFareHold({
    sb: db3,
    stripe: stripe3,
    trip: waiveTrip,
    finalFareCents: 45,
  })
  assert.equal(settled3.ok, true)
  assert.equal(settled3.method, 'none')
  assert.equal(settled3.reason, 'below_minimum')
  assert.equal(db3.tables.trips[0].metadata.fare_authorization.status, 'waived')
})

test('settleFareHold handles overage charge success and partial overage charge failure', async () => {
  // Settle where final fare exceeds hold and overage is successfully charged to default card
  const overageTrip = {
    id: 't_overage_ok',
    rider_id: 'rider_test_overage',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_main',
        authorizationCents: 5000,
      },
    },
  }
  const db = memoryDb({
    trips: [overageTrip],
    profiles: [{ id: 'rider_test_overage', stripe_customer_id: 'cus_test_overage', stripe_default_pm_id: 'pm_test_card' }],
  })
  // Stripe captures the 5000 hold, and creates a separate payment intent for the 2000 excess
  let capturedAmount = null
  let extraChargeAmount = null
  const overageStripe = {
    paymentIntents: {
      async retrieve(id) {
        return { id, status: 'requires_capture', amount: 5000 }
      },
      async capture(id, params) {
        capturedAmount = params.amount_to_capture
        return { id, status: 'succeeded', amount_received: params.amount_to_capture }
      },
      async create(params) {
        extraChargeAmount = params.amount
        return { id: 'pi_test_overage_charge', status: 'succeeded', amount: params.amount }
      },
      async cancel() { return { status: 'canceled' } },
    },
    paymentMethods: {
      async list() { return { data: [] } },
    },
  }
  const settledOverage = await settleFareHold({
    sb: db,
    stripe: overageStripe,
    trip: overageTrip,
    finalFareCents: 7000,
  })
  assert.equal(settledOverage.ok, true)
  assert.equal(settledOverage.method, 'card')
  assert.equal(settledOverage.amountCents, 7000)
  assert.equal(settledOverage.paymentIntentId, 'pi_test_hold_main')
  assert.equal(settledOverage.overagePaymentIntentId, 'pi_test_overage_charge')
  assert.equal(capturedAmount, 5000)
  assert.equal(extraChargeAmount, 2000)
  assert.equal(db.tables.trips[0].metadata.fare_authorization.status, 'captured')

  // Settle where overage charge fails: hold is captured, overage is parked as outstanding balance
  const partialTrip = {
    id: 't_overage_fail',
    rider_id: 'rider_test_overage_fail',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_partial',
        authorizationCents: 5000,
      },
    },
  }
  const dbFail = memoryDb({
    trips: [partialTrip],
    profiles: [{ id: 'rider_test_overage_fail', stripe_customer_id: 'cus_fail', stripe_default_pm_id: 'pm_fail' }],
  })
  const overageFailStripe = {
    paymentIntents: {
      async retrieve(id) {
        return { id, status: 'requires_capture', amount: 5000 }
      },
      async capture(id, params) {
        return { id, status: 'succeeded', amount_received: params.amount_to_capture }
      },
      async create() {
        throw new Error('Insufficient funds for overage')
      },
      async cancel() { return { status: 'canceled' } },
    },
    paymentMethods: {
      async list() { return { data: [] } },
    },
  }
  const settledPartial = await settleFareHold({
    sb: dbFail,
    stripe: overageFailStripe,
    trip: partialTrip,
    finalFareCents: 7500,
  })
  assert.equal(settledPartial.ok, false)
  assert.equal(settledPartial.parked, true)
  assert.equal(settledPartial.capturedCents, 5000)
  assert.equal(settledPartial.outstanding.amountCents, 2500)
  assert.equal(settledPartial.outstanding.reason, 'overage_failed')
  assert.equal(dbFail.tables.trips[0].metadata.fare_authorization.status, 'partial')
})

