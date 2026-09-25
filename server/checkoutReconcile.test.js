import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import {
  applyPaidCheckoutSession,
  reconcileCheckoutSession,
  recordDeposit,
} from './checkoutReconcile.js'
import webhookHandler from '../api/stripe-webhook.js'
import reconcileCheckoutHandler from './endpoints/reconcileCheckout.js'
import stripePaymentHandler from '../api/stripe-payment-methods.js'

function createMockDb() {
  const trips = new Map()
  const payments = []
  const events = []
  const rpcCalls = []

  function match(row, filters) {
    return filters.every((f) => {
      if (f.type === 'eq') return row[f.col] === f.val
      if (f.type === 'is') return f.val == null ? row[f.col] == null : row[f.col] === f.val
      return false
    })
  }

  function from(table) {
    const state = { table, filters: [], op: 'select', patch: null }
    const api = {
      select() { return api },
      eq(col, val) { state.filters.push({ type: 'eq', col, val }); return api },
      is(col, val) { state.filters.push({ type: 'is', col, val }); return api },
      update(patch) { state.op = 'update'; state.patch = patch; return api },
      insert(row) { state.op = 'insert'; state.patch = row; return api },
      maybeSingle() {
        return Promise.resolve(exec()).then((res) => ({
          data: Array.isArray(res.data) ? (res.data[0] || null) : res.data,
          error: res.error,
        }))
      },
      single() {
        return Promise.resolve(exec()).then((res) => ({
          data: Array.isArray(res.data) ? (res.data[0] || null) : res.data,
          error: res.error,
        }))
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject)
      },
    }

    function exec() {
      if (table === 'trip_events' && state.op === 'insert') {
        events.push(state.patch)
        return { data: state.patch, error: null }
      }
      if (table === 'payments') {
        if (state.op === 'insert') {
          const row = { id: `pay_${payments.length + 1}`, ...state.patch }
          payments.push(row)
          return { data: row, error: null }
        }
        const matches = payments.filter((row) => match(row, state.filters))
        return { data: matches, error: null }
      }
      if (table === 'trips') {
        let rows = [...trips.values()].filter((row) => match(row, state.filters))
        if (state.op === 'update') {
          const updated = rows.map((row) => {
            const next = { ...row, ...state.patch }
            trips.set(next.id, next)
            return next
          })
          return { data: updated, error: null }
        }
        return { data: rows, error: null }
      }
      return { data: null, error: null }
    }

    return api
  }

  function rpc(fn, args) {
    rpcCalls.push({ fn, args })
    if (fn === 'grant_rider_social_for_trip') {
      return Promise.resolve({ data: { ok: true, granted: false }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }

  return {
    from,
    rpc,
    trips,
    payments,
    events,
    rpcCalls,
    seedTrip(trip) {
      trips.set(trip.id, {
        id: trip.id,
        driver_id: null,
        status: 'searching',
        scheduled_for: null,
        canceled_at: null,
        rider_id: 'rider_1',
        metadata: {},
        ...trip,
      })
    },
  }
}

function createMockStripe(sessionsMap) {
  let retrieveCalls = 0
  return {
    get retrieveCalls() { return retrieveCalls },
    checkout: {
      sessions: {
        async retrieve(id) {
          retrieveCalls += 1
          if (sessionsMap instanceof Error) throw sessionsMap
          if (typeof sessionsMap === 'function') return sessionsMap(id)
          const session = sessionsMap.get(id)
          if (!session) {
            const err = new Error(`No such checkout session: ${id}`)
            err.statusCode = 404
            throw err
          }
          return session
        },
      },
    },
  }
}

function mockReq({ method = 'POST', headers = {}, body = '' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const stream = Readable.from([buf])
  stream.method = method
  stream.headers = headers
  return stream
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

test('paid first time: marks deposit paid, creates payment row, and updates trip metadata', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_100',
    rider_id: 'rider_ada',
    status: 'searching',
    metadata: { purpose: 'airport', deposit_cents: 2500 },
  })

  const session = {
    id: 'cs_paid_100',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: 'pi_paid_100',
    metadata: {
      tripId: 'trip_100',
      riderId: 'rider_ada',
      airport: 'GSP',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const result = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_paid_100',
    userId: 'rider_ada',
  })

  assert.equal(result.ok, true)
  assert.equal(result.paid, true)
  assert.equal(result.alreadyRecorded, false)
  assert.equal(result.tripId, 'trip_100')

  // Verify payments table
  assert.equal(db.payments.length, 1)
  const payment = db.payments[0]
  assert.equal(payment.trip_id, 'trip_100')
  assert.equal(payment.rider_id, 'rider_ada')
  assert.equal(payment.stripe_payment_intent_id, 'pi_paid_100')
  assert.equal(payment.kind, 'deposit')
  assert.equal(payment.status, 'succeeded')
  assert.equal(payment.amount_cents, 2500)

  // Verify trip metadata
  const trip = db.trips.get('trip_100')
  assert.equal(trip.metadata.fare_paid_cents, 2500)
  assert.equal(typeof trip.metadata.checkout_deposit, 'object')
  assert.equal(trip.metadata.checkout_deposit.session_id, 'cs_paid_100')

  // Verify social referral was called
  assert.equal(db.rpcCalls.length, 1)
  assert.equal(db.rpcCalls[0].fn, 'grant_rider_social_for_trip')
  assert.deepEqual(db.rpcCalls[0].args, { p_trip_id: 'trip_100' })
})

test('paid second time: idempotent, returns alreadyRecorded true with no duplicate payment rows', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_101',
    rider_id: 'rider_ada',
    status: 'searching',
    metadata: { purpose: 'airport', deposit_cents: 2500 },
  })

  const session = {
    id: 'cs_paid_101',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: 'pi_paid_101',
    metadata: {
      tripId: 'trip_101',
      riderId: 'rider_ada',
      airport: 'GSP',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  // First call
  const first = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_paid_101',
    userId: 'rider_ada',
  })
  assert.equal(first.ok, true)
  assert.equal(first.paid, true)
  assert.equal(first.alreadyRecorded, false)
  assert.equal(db.payments.length, 1)

  // Second call
  const second = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_paid_101',
    userId: 'rider_ada',
  })
  assert.equal(second.ok, true)
  assert.equal(second.paid, true)
  assert.equal(second.alreadyRecorded, true)
  assert.equal(second.tripId, 'trip_101')

  // No duplicate payment rows
  assert.equal(db.payments.length, 1)

  // fare_paid_cents not doubled
  const trip = db.trips.get('trip_101')
  assert.equal(trip.metadata.fare_paid_cents, 2500)
})

test('unpaid session: returns paid false and makes no database writes', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_102',
    rider_id: 'rider_ada',
    status: 'searching',
    metadata: { purpose: 'airport', deposit_cents: 2500 },
  })

  const session = {
    id: 'cs_unpaid_102',
    status: 'open',
    payment_status: 'unpaid',
    amount_total: 2500,
    metadata: {
      tripId: 'trip_102',
      riderId: 'rider_ada',
      airport: 'GSP',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const result = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_unpaid_102',
    userId: 'rider_ada',
  })

  assert.equal(result.ok, true)
  assert.equal(result.paid, false)
  assert.equal(result.tripId, 'trip_102')

  // No payments row written
  assert.equal(db.payments.length, 0)

  // Trip metadata untouched
  const trip = db.trips.get('trip_102')
  assert.equal(trip.metadata.checkout_deposit, undefined)
  assert.equal(trip.metadata.fare_paid_cents, undefined)
  assert.equal(db.rpcCalls.length, 0)
})

test('other user session: returns 403-style error and prevents unauthorized reconciliation', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_103',
    rider_id: 'rider_owner',
    status: 'searching',
    metadata: { purpose: 'airport' },
  })

  const session = {
    id: 'cs_other_103',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    metadata: {
      tripId: 'trip_103',
      riderId: 'rider_owner',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  // Attempted by a different user
  const result = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_other_103',
    userId: 'rider_attacker',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(result.reason, 'forbidden')

  // No payments row written
  assert.equal(db.payments.length, 0)
  assert.equal(db.trips.get('trip_103').metadata.checkout_deposit, undefined)
})

test('bad session id: validates cs_ prefix without calling Stripe', async () => {
  const db = createMockDb()
  const stripe = createMockStripe(new Map())

  const invalidIds = ['', null, undefined, 'pi_12345', 'invalid_session', 'cs_', 'cs']
  for (const id of invalidIds) {
    const result = await reconcileCheckoutSession({
      stripe,
      sb: db,
      sessionId: id,
      userId: 'rider_ada',
    })
    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.equal(result.reason, 'bad_id')
  }

  // Stripe retrieve was never called
  assert.equal(stripe.retrieveCalls, 0)
})

test('Stripe retrieve error: gracefully handles errors without throwing unhandled exception', async () => {
  const db = createMockDb()
  const stripe = {
    checkout: {
      sessions: {
        async retrieve() {
          throw new Error('Stripe API unavailable')
        },
      },
    },
  }

  const result = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_error_104',
    userId: 'rider_ada',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 502)
  assert.match(result.error, /Stripe API unavailable/)
  assert.equal(db.payments.length, 0)
})

test('skips credit_purchase sessions cleanly', async () => {
  const db = createMockDb()
  const session = {
    id: 'cs_credit_105',
    status: 'complete',
    payment_status: 'paid',
    metadata: {
      kind: 'credit_purchase',
      profile_id: 'rider_ada',
      pack_id: 'pack_50',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const result = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_credit_105',
    userId: 'rider_ada',
  })

  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'credit_purchase')
  assert.equal(db.payments.length, 0)
})

test('restores abandoned canceled trip back to searching on deposit payment', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_106',
    rider_id: 'rider_ada',
    status: 'canceled',
    canceled_at: '2026-09-24T12:00:00.000Z',
    metadata: {
      purpose: 'airport',
      checkout_abandoned: { session_id: 'cs_paid_106', reason: 'checkout_expired' },
    },
  })

  const session = {
    id: 'cs_paid_106',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: 'pi_paid_106',
    metadata: {
      tripId: 'trip_106',
      riderId: 'rider_ada',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const result = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: 'cs_paid_106',
    userId: 'rider_ada',
  })

  assert.equal(result.ok, true)
  assert.equal(result.paid, true)

  const trip = db.trips.get('trip_106')
  assert.equal(trip.status, 'searching')
  assert.equal(trip.canceled_at, null)
  assert.equal(trip.metadata.checkout_abandoned, undefined)
  assert.equal(trip.metadata.checkout_deposit.session_id, 'cs_paid_106')
})

test('webhook still works through the shared function', async () => {
  const origKey = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_secret'

  try {
    const db = createMockDb()
    db.seedTrip({
      id: 'trip_wh_1',
      rider_id: 'rider_wh',
      status: 'canceled',
      canceled_at: '2026-09-24T12:00:00.000Z',
      metadata: {
        purpose: 'airport',
        checkout_abandoned: { session_id: 'cs_wh_1', reason: 'checkout_expired' },
      },
    })

    const session = {
      id: 'cs_wh_1',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 2500,
      payment_intent: 'pi_wh_1',
      metadata: {
        tripId: 'trip_wh_1',
        riderId: 'rider_wh',
        kind: 'airport_deposit',
      },
    }

    const event = {
      type: 'checkout.session.completed',
      data: { object: session },
    }

    const req = mockReq({ body: JSON.stringify(event) })
    const res = mockRes()

    await webhookHandler(req, res, {
      serviceClient: () => db,
      serviceKey: 'mock_service_key',
    })

    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.received, true)
    assert.equal(body.type, 'checkout.session.completed')
    assert.equal(body.recorded.ok, true)
    assert.equal(body.recorded.alreadyRecorded, false)
    assert.equal(body.live.restored, true)
    assert.equal(body.live.status, 'searching')

    // Trip restored and marked
    assert.equal(db.payments.length, 1)
    assert.equal(db.trips.get('trip_wh_1').status, 'searching')

    // Second webhook event replay is idempotent
    const req2 = mockReq({ body: JSON.stringify(event) })
    const res2 = mockRes()
    await webhookHandler(req2, res2, {
      serviceClient: () => db,
      serviceKey: 'mock_service_key',
    })

    assert.equal(res2.statusCode, 200)
    const body2 = JSON.parse(res2.body)
    assert.equal(body2.recorded.alreadyRecorded, true)
    assert.equal(db.payments.length, 1)
  } finally {
    process.env.STRIPE_SECRET_KEY = origKey
  }
})

test('reconcileCheckout endpoint: 405 on non-POST method', async () => {
  const req = { method: 'GET', url: '/api/stripe-payment-methods?action=reconcile-checkout' }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res)
  assert.equal(res.statusCode, 405)
  const body = JSON.parse(res.body)
  assert.match(body.error, /Method not allowed/)
})

test('reconcileCheckout endpoint: 503 when Stripe is not configured', async () => {
  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: { sessionId: 'cs_123' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripeOk: () => false,
    stripe: null,
  })
  assert.equal(res.statusCode, 503)
  const body = JSON.parse(res.body)
  assert.match(body.error, /Payments unavailable/)
})

test('reconcileCheckout endpoint: 503 when service role is not configured', async () => {
  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: { sessionId: 'cs_123' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripeOk: () => true,
    stripe: {},
    sb: null,
  })
  assert.equal(res.statusCode, 503)
  const body = JSON.parse(res.body)
  assert.match(body.error, /SUPABASE_SERVICE_ROLE_KEY not configured/)
})

test('reconcileCheckout endpoint: 401 when not signed in', async () => {
  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', headers: {}, body: { sessionId: 'cs_123' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripeOk: () => true,
    stripe: {},
    sb: {},
    userFromAuth: async () => null,
  })
  assert.equal(res.statusCode, 401)
  const body = JSON.parse(res.body)
  assert.match(body.error, /Sign in required/)
})

test('reconcileCheckout endpoint: 400 when sessionId is missing', async () => {
  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: {} }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripeOk: () => true,
    stripe: {},
    sb: {},
    user: { id: 'rider_ada' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body)
  assert.match(body.error, /sessionId required/)
})

test('reconcileCheckout endpoint: 400 when sessionId is invalid format', async () => {
  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: { sessionId: 'not_a_checkout_session' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripeOk: () => true,
    stripe: {},
    sb: {},
    user: { id: 'rider_ada' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body)
  assert.equal(body.error, 'invalid_session_id')
})

test('reconcileCheckout endpoint: 403 when session belongs to a different rider', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_other',
    rider_id: 'rider_bob',
    status: 'searching',
    metadata: { purpose: 'airport' },
  })

  const session = {
    id: 'cs_other_1',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: 'pi_other_1',
    metadata: {
      tripId: 'trip_other',
      riderId: 'rider_bob',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: { sessionId: 'cs_other_1' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripe,
    sb: db,
    user: { id: 'rider_ada' },
  })
  assert.equal(res.statusCode, 403)
  const body = JSON.parse(res.body)
  assert.equal(body.error, 'forbidden')
})

test('reconcileCheckout endpoint: 200 when unpaid session', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_unpaid_ep',
    rider_id: 'rider_ada',
    status: 'searching',
    metadata: { purpose: 'airport' },
  })

  const session = {
    id: 'cs_unpaid_ep',
    status: 'open',
    payment_status: 'unpaid',
    metadata: {
      tripId: 'trip_unpaid_ep',
      riderId: 'rider_ada',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: { sessionId: 'cs_unpaid_ep' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripe,
    sb: db,
    user: { id: 'rider_ada' },
  })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.paid, false)
  assert.equal(body.tripId, 'trip_unpaid_ep')
})

test('reconcileCheckout endpoint: 200 when paid session and marks paid idempotently', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_paid_ep',
    rider_id: 'rider_ada',
    status: 'searching',
    metadata: { purpose: 'airport', deposit_cents: 2500 },
  })

  const session = {
    id: 'cs_paid_ep',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: 'pi_paid_ep',
    metadata: {
      tripId: 'trip_paid_ep',
      riderId: 'rider_ada',
      airport: 'GSP',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const req = { method: 'POST', url: '/api/stripe-payment-methods?action=reconcile-checkout', body: { sessionId: 'cs_paid_ep' } }
  const res = mockRes()
  await reconcileCheckoutHandler(req, res, {
    stripe,
    sb: db,
    user: { id: 'rider_ada' },
  })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.paid, true)
  assert.equal(body.alreadyRecorded, false)
  assert.equal(body.tripId, 'trip_paid_ep')

  // Calling a second time is idempotent
  const res2 = mockRes()
  await reconcileCheckoutHandler(req, res2, {
    stripe,
    sb: db,
    user: { id: 'rider_ada' },
  })
  assert.equal(res2.statusCode, 200)
  const body2 = JSON.parse(res2.body)
  assert.equal(body2.ok, true)
  assert.equal(body2.paid, true)
  assert.equal(body2.alreadyRecorded, true)
})

test('reconcileCheckout routed through api/stripe-payment-methods?action=reconcile-checkout', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_route_ep',
    rider_id: 'rider_ada',
    status: 'searching',
    metadata: { purpose: 'airport', deposit_cents: 2500 },
  })

  const session = {
    id: 'cs_route_ep',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: 'pi_route_ep',
    metadata: {
      tripId: 'trip_route_ep',
      riderId: 'rider_ada',
      airport: 'GSP',
      kind: 'airport_deposit',
    },
  }
  const stripe = createMockStripe(new Map([[session.id, session]]))

  const req = {
    method: 'POST',
    url: '/api/stripe-payment-methods?action=reconcile-checkout',
    body: { sessionId: 'cs_route_ep' },
    headers: {},
  }
  const res = mockRes()
  await stripePaymentHandler(req, res, {
    stripe,
    sb: db,
    user: { id: 'rider_ada' },
  })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.paid, true)
  assert.equal(body.tripId, 'trip_route_ep')
})

test('create-checkout-session and airport-checkout success_url carry session_id={CHECKOUT_SESSION_ID}', () => {
  const createCheckoutSrc = readFileSync(new URL('../api/create-checkout-session.js', import.meta.url), 'utf8')
  const airportCheckoutSrc = readFileSync(new URL('./endpoints/airportCheckout.js', import.meta.url), 'utf8')

  assert.match(
    createCheckoutSrc,
    /success_url:\s*`\${origin}\/\${checkoutSuccessHash\([\s\S]*?\)}&session_id=\{CHECKOUT_SESSION_ID\}`/
  )
  assert.match(
    airportCheckoutSrc,
    /success_url:\s*`\${origin}\/\${checkoutSuccessHash\([\s\S]*?\)}&session_id=\{CHECKOUT_SESSION_ID\}`/
  )
})
