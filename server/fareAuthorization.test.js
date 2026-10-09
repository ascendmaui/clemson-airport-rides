import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { capturePlan, fareAuthorizationCents, shouldRetryAuthorization } from '../shared/fareAuthorization.js'
import { authorizeRideRequest, isIncrementalAuthIneligible, placeFareAuthorization, settleFareHold } from './fareAuthorization.js'

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
          ...(step?.last_payment_error ? { last_payment_error: step.last_payment_error } : {}),
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

test('incremental eligibility detection requires both the code and message', () => {
  const raw = {
    type: 'invalid_request_error',
    code: 'payment_intent_invalid_parameter',
    message: 'This account is NOT ELIGIBLE FOR THE REQUESTED CARD FEATURES.',
  }
  assert.equal(isIncrementalAuthIneligible(raw), true)
  assert.equal(isIncrementalAuthIneligible({ raw, message: 'Wrapper message' }), true)
  assert.equal(isIncrementalAuthIneligible({ ...raw, code: 'parameter_unknown' }), false)
  assert.equal(isIncrementalAuthIneligible({ ...raw, message: 'Invalid amount' }), false)
  assert.equal(isIncrementalAuthIneligible(null), false)
})

test('an ineligible account retries a basic hold with identical fare params and persists the flag', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{ id: 'trip_basic', rider_id: 'rider_1', fare_cents: 5000, boost_cents: 1000, metadata: {} }],
  })
  const err = new Error('Wrapper message')
  err.raw = {
    type: 'invalid_request_error',
    code: 'payment_intent_invalid_parameter',
    param: null,
    message: 'This account is not eligible for the requested card features. See https://stripe.com/docs/payments/flexible-payments for more details.',
  }
  const stripe = scriptedStripe({ creates: [{ error: err }, { id: 'pi_basic', status: 'requires_capture' }] })
  const placed = await authorizeRideRequest({ sb: db, stripe, trip: db.tables.trips[0] })
  assert.equal(placed.ok, true)
  assert.equal(placed.authorization.paymentIntentId, 'pi_basic')
  assert.equal(placed.authorization.incrementalAuthorization, false)
  assert.equal(db.tables.trips[0].metadata.fare_authorization.incrementalAuthorization, false)
  assert.equal(placed.attempts.length, 1)
  const creates = stripe.calls.filter((call) => call.op === 'create')
  assert.equal(creates.length, 2)
  assert.equal(creates[0].params.payment_method_options.card.request_incremental_authorization, 'if_available')
  assert.equal(creates[1].params.payment_method_options, undefined)
  assert.deepEqual(creates[1].options, { idempotencyKey: `${creates[0].options.idempotencyKey}:basic` })
  const expected = { ...creates[0].params }
  delete expected.payment_method_options
  assert.deepEqual(creates[1].params, expected)
  assert.equal(expected.amount, 7000)
  assert.deepEqual(expected.metadata, {
    kind: 'fare_authorization', tripId: 'trip_basic', riderId: 'rider_1',
    estimatedFareCents: '5000', bufferCents: '1000', boostCents: '1000',
  })
})

test('other invalid request errors keep one create per attempt and the existing failure code', async (t) => {
  t.mock.method(console, 'error', () => {})
  for (const raw of [
    { code: 'payment_intent_invalid_parameter', message: 'Invalid amount' },
    { code: 'parameter_unknown', message: 'This account is not eligible for the requested card features.' },
  ]) {
    const stripe = scriptedStripe({ creates: [{ error: { raw: { type: 'invalid_request_error', ...raw } } }] })
    const placed = await placeFareAuthorization({
      stripe, tripId: 'trip_invalid', customerId: 'cus_1', paymentMethodId: 'pm_default',
      backupPaymentMethodIds: [], estimatedFareCents: 5000,
    })
    assert.equal(placed.ok, false)
    assert.equal(placed.failure.code, 'charge_failed')
    assert.deepEqual(placed.attempts.map((attempt) => attempt.suffix), ['initial', 'retry'])
    const creates = stripe.calls.filter((call) => call.op === 'create')
    assert.equal(creates.length, placed.attempts.length)
    assert.deepEqual(creates.map((call) => call.options.idempotencyKey), ['fare_auth:trip_invalid', 'fare_auth:trip_invalid:retry'])
    for (const call of creates) {
      assert.equal(call.params.payment_method_options.card.request_incremental_authorization, 'if_available')
    }
  }
})

test('an eligible account keeps the original incremental hold request', async () => {
  const stripe = scriptedStripe({ creates: [{ id: 'pi_eligible', status: 'requires_capture' }] })
  const placed = await placeFareAuthorization({
    stripe, tripId: 'trip_eligible', riderId: 'rider_1', customerId: 'cus_1', paymentMethodId: 'pm_default',
    backupPaymentMethodIds: [], estimatedFareCents: 5000,
  })
  assert.equal(placed.ok, true)
  assert.equal(placed.authorization.incrementalAuthorization, undefined)
  const creates = stripe.calls.filter((call) => call.op === 'create')
  assert.equal(creates.length, 1)
  assert.deepEqual(creates[0], {
    op: 'create',
    params: {
      amount: 6000, currency: 'usd', customer: 'cus_1', payment_method: 'pm_default',
      capture_method: 'manual', confirm: true, off_session: true,
      payment_method_options: { card: { request_incremental_authorization: 'if_available' } },
      description: 'Clemson RIDES fare hold',
      metadata: {
        kind: 'fare_authorization', tripId: 'trip_eligible', riderId: 'rider_1',
        estimatedFareCents: '5000', bufferCents: '1000', boostCents: '0',
      },
    },
    options: { idempotencyKey: 'fare_auth:trip_eligible' },
  })
})

test('a failed basic hold does not repeat the fallback within an authorization attempt', async (t) => {
  t.mock.method(console, 'error', () => {})
  const err = {
    code: 'payment_intent_invalid_parameter',
    message: 'This account is not eligible for the requested card features.',
  }
  const stripe = scriptedStripe({ creates: [{ error: err }] })
  const placed = await placeFareAuthorization({
    stripe, tripId: 'trip_basic_fail', customerId: 'cus_1', paymentMethodId: 'pm_default',
    backupPaymentMethodIds: [], estimatedFareCents: 5000,
  })
  assert.equal(placed.ok, false)
  assert.equal(placed.failure.code, 'charge_failed')
  assert.equal(placed.attempts.length, 2)
  assert.deepEqual(stripe.calls.filter((call) => call.op === 'create').map((call) => call.options.idempotencyKey), [
    'fare_auth:trip_basic_fail', 'fare_auth:trip_basic_fail:basic',
    'fare_auth:trip_basic_fail:retry', 'fare_auth:trip_basic_fail:retry:basic',
  ])
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

test('Stripe request errors persist only sanitized diagnostics and keep charge_failed retries', async (t) => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{ id: 'trip_diagnostics', rider_id: 'rider_1', fare_cents: 5000, metadata: {} }],
  })
  const message = `Unknown parameter. ${'x'.repeat(350)}`
  const err = new Error('Wrapper message must not replace raw message')
  err.raw = {
    type: 'invalid_request_error',
    code: 'parameter_unknown',
    param: 'payment_method_options[card][request_incremental_authorization]',
    message: `  ${message}  `,
    headers: { authorization: 'secret header' },
    api_key: 'sk_test_private',
    client_secret: 'pi_private_secret_private',
    payment_intent: { id: 'pi_failed', status: 'requires_payment_method', client_secret: 'pi_private_secret_private' },
  }
  const stripe = scriptedStripe({ creates: [{ error: err }], methods: ['pm_backup'] })
  const log = t.mock.method(console, 'error', () => {})
  const placed = await authorizeRideRequest({ sb: db, stripe, trip: db.tables.trips[0] })
  const expected = {
    type: 'invalid_request_error',
    code: 'parameter_unknown',
    decline_code: null,
    param: 'payment_method_options[card][request_incremental_authorization]',
    message: message.slice(0, 300),
  }
  assert.equal(placed.ok, false)
  assert.equal(placed.failure.code, 'charge_failed')
  assert.equal(placed.outstanding.code, 'charge_failed')
  assert.equal(db.tables.trips[0].metadata.fare_authorization.code, 'charge_failed')
  assert.equal(placed.attempts.length, 3)
  assert.deepEqual(placed.attempts.map((attempt) => attempt.suffix), ['initial', 'retry', 'pm:pm_backup'])
  for (const attempt of placed.attempts) {
    assert.equal(attempt.code, 'charge_failed')
    assert.deepEqual(attempt.stripeError, expected)
  }
  assert.deepEqual(db.tables.trips[0].metadata.outstanding_balance.attempts, placed.attempts)
  assert.equal(log.mock.calls.length, 3)
  for (const call of log.mock.calls) {
    assert.equal(call.arguments.length, 1)
    assert.deepEqual(JSON.parse(call.arguments[0]), {
      level: 'error', msg: 'fare_authorization_failed', tripId: 'trip_diagnostics',
      code: 'charge_failed', stripeError: expected,
    })
  }
})

test('Stripe diagnostics use the error itself when raw is absent and redact secrets', async (t) => {
  t.mock.method(console, 'error', () => {})
  const err = new Error('  Invalid key sk_test_private and client secret pi_private_secret_private  ')
  err.type = 'api_error'
  const placed = await placeFareAuthorization({
    stripe: scriptedStripe({ creates: [{ error: err }] }),
    tripId: 'trip_fallback', customerId: 'cus_1', paymentMethodId: 'pm_default',
    backupPaymentMethodIds: [], estimatedFareCents: 5000,
  })
  assert.equal(placed.failure.code, 'charge_failed')
  assert.deepEqual(placed.attempts[0].stripeError, {
    type: 'api_error', code: null, decline_code: null, param: null,
    message: 'Invalid key [redacted] and client secret [redacted]',
  })
})

test('unsuccessful PaymentIntents include sanitized last payment errors without changing codes', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  for (const status of ['requires_payment_method', 'requires_action']) {
    const message = 'Declined. '.repeat(40)
    const stripe = scriptedStripe({ creates: [{
      status,
      last_payment_error: {
        code: 'card_declined', decline_code: 'generic_decline', message,
        payment_method: { id: 'pm_default' }, client_secret: 'pi_private_secret_private',
      },
    }] })
    const placed = await placeFareAuthorization({
      stripe, tripId: 'trip_status', customerId: 'cus_1', paymentMethodId: 'pm_default',
      backupPaymentMethodIds: [], estimatedFareCents: 5000,
    })
    const code = status === 'requires_action' ? 'authentication_required' : 'charge_failed'
    assert.equal(placed.failure.code, code)
    assert.equal(placed.attempts.length, status === 'requires_action' ? 1 : 2)
    for (const attempt of placed.attempts) {
      assert.equal(attempt.code, code)
      assert.deepEqual(attempt.stripeError, {
        status,
        last_payment_error: {
          code: 'card_declined', decline_code: 'generic_decline', message: message.trim().slice(0, 300),
        },
      })
    }
  }
  assert.equal(log.mock.calls.length, 3)
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
