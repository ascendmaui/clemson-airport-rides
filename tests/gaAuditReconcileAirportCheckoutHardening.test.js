import test from 'node:test'
import assert from 'node:assert/strict'
import reconcileCheckoutHandler from '../server/endpoints/reconcileCheckout.js'
import airportCheckoutHandler from '../server/endpoints/airportCheckout.js'
import { reconcileCheckoutSession } from '../server/checkoutReconcile.js'
import {
  parseHoldSweepLimit,
  parseHoldSweepTtlMs,
} from '../server/endpoints/expireUnpaidAirportHolds.js'

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT')
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function parseResJson(res) {
  try {
    return res.body ? JSON.parse(res.body) : null
  } catch {
    return null
  }
}

function createMockSb() {
  const trips = new Map()
  const payments = []

  const api = {
    trips,
    payments,
    from(table) {
      const filters = []
      let op = 'select'
      let patch = null

      const chain = {
        select() { return chain },
        eq(col, val) { filters.push({ col, val }); return chain },
        single() {
          return Promise.resolve(chain.exec()).then((r) => ({
            data: Array.isArray(r.data) ? (r.data[0] || null) : r.data,
            error: r.error,
          }))
        },
        maybeSingle() {
          return Promise.resolve(chain.exec()).then((r) => ({
            data: Array.isArray(r.data) ? (r.data[0] || null) : r.data,
            error: r.error,
          }))
        },
        insert(data) {
          op = 'insert'
          patch = data
          return chain
        },
        update(data) {
          op = 'update'
          patch = data
          return chain
        },
        exec() {
          if (table === 'trips') {
            if (op === 'insert') {
              const id = `trip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              const row = { id, ...patch }
              trips.set(id, row)
              return { data: row, error: null }
            }
            const matching = [...trips.values()].filter((t) => filters.every((f) => t[f.col] === f.val))
            if (op === 'update') {
              matching.forEach((t) => {
                Object.assign(t, patch)
                trips.set(t.id, t)
              })
              return { data: matching, error: null }
            }
            return { data: matching, error: null }
          }
          if (table === 'payments') {
            if (op === 'insert') {
              const row = { id: `pay_${payments.length + 1}`, ...patch }
              payments.push(row)
              return { data: row, error: null }
            }
            const matching = payments.filter((p) => filters.every((f) => p[f.col] === f.val))
            return { data: matching, error: null }
          }
          return { data: [], error: null }
        },
        then(resolve, reject) {
          return Promise.resolve(chain.exec()).then(resolve, reject)
        },
      }
      return chain
    },
  }
  return api
}

test('GA99: reconcileCheckoutHandler enforces HTTP methods, headers, and auth', async () => {
  // GET method rejected
  const resGet = mockRes()
  await reconcileCheckoutHandler({ method: 'GET', headers: {} }, resGet)
  assert.equal(resGet.statusCode, 405)
  assert.equal(resGet.headers['allow'], 'POST, OPTIONS')
  assert.equal(resGet.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')

  // Sign-in required
  const resAuth = mockRes()
  await reconcileCheckoutHandler(
    { method: 'POST', headers: {} },
    resAuth,
    { stripeOk: () => true, admin: () => createMockSb(), user: null }
  )
  assert.equal(resAuth.statusCode, 401)
  assert.equal(parseResJson(resAuth).error, 'Sign in required')

  // Payments unavailable
  const resPay = mockRes()
  await reconcileCheckoutHandler(
    { method: 'POST', headers: {} },
    resPay,
    { stripeOk: () => false, admin: () => createMockSb(), user: { id: 'u1' } }
  )
  assert.equal(resPay.statusCode, 503)
  assert.equal(parseResJson(resPay).error, 'Payments unavailable')
})

test('GA99: reconcileCheckoutHandler sanitizes sessionId from body and query with quotes stripped', async () => {
  let reconciledArgs = null
  const deps = {
    stripeOk: () => true,
    admin: () => createMockSb(),
    user: { id: 'u_rider_1' },
    stripe: { checkout: {} },
    reconcileCheckoutSession: async (args) => {
      reconciledArgs = args
      return { ok: true, paid: true, status: 200 }
    },
  }

  // From body.sessionId with double quotes and whitespace
  const res1 = mockRes()
  await reconcileCheckoutHandler(
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '  "cs_test_quotes_123"  ' }),
    },
    res1,
    deps
  )
  assert.equal(res1.statusCode, 200)
  assert.equal(reconciledArgs.sessionId, 'cs_test_quotes_123')

  // From body.session_id with single quotes
  const res2 = mockRes()
  await reconcileCheckoutHandler(
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: "  'cs_test_single_quotes'  " }),
    },
    res2,
    deps
  )
  assert.equal(res2.statusCode, 200)
  assert.equal(reconciledArgs.sessionId, 'cs_test_single_quotes')

  // From req.query.session_id fallback
  const res3 = mockRes()
  await reconcileCheckoutHandler(
    {
      method: 'POST',
      headers: {},
      query: { session_id: 'cs_test_from_query' },
    },
    res3,
    deps
  )
  assert.equal(res3.statusCode, 200)
  assert.equal(reconciledArgs.sessionId, 'cs_test_from_query')

  // Missing session ID returns 400
  const resMissing = mockRes()
  await reconcileCheckoutHandler(
    { method: 'POST', headers: {}, body: JSON.stringify({}) },
    resMissing,
    deps
  )
  assert.equal(resMissing.statusCode, 400)
  assert.equal(parseResJson(resMissing).error, 'sessionId required')
})

test('GA99: reconcileCheckoutSession strips quotes and validates ID format', async () => {
  // Empty or malformed ID
  const invalid1 = await reconcileCheckoutSession({ sessionId: '   ' })
  assert.equal(invalid1.ok, false)
  assert.equal(invalid1.status, 400)
  assert.equal(invalid1.error, 'invalid_session_id')

  const invalid2 = await reconcileCheckoutSession({ sessionId: '"pi_12345"' })
  assert.equal(invalid2.ok, false)
  assert.equal(invalid2.status, 400)

  // Valid format with quotes passes validation and calls retrieve
  let retrievedId = null
  const stripe = {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          retrievedId = id
          return {
            id,
            metadata: { kind: 'credit_purchase' }, // causes early return skipped
          }
        },
      },
    },
  }
  const result = await reconcileCheckoutSession({
    stripe,
    sb: createMockSb(),
    sessionId: '  "cs_test_valid_clean"  ',
    userId: 'u1',
  })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(retrievedId, 'cs_test_valid_clean')
})

test('GA99: airportCheckoutHandler sanitizes airport code and handles credit bookings', async () => {
  const sb = createMockSb()
  let debitedLotsCalled = false
  let chargePaymentCalled = false

  const deps = {
    sb,
    user: { id: 'rider_99', email: 'test@clemson.edu' },
    ensureProfile: async () => ({ ok: true }),
    computeRoutes: async () => ({ distanceM: 70000, durationS: 3000 }),
    loadGameDayMultiplier: async () => ({ multiplier: 1.0 }),
    tigerPassBpsForRider: async () => 0,
    studentDiscountGranted: () => true,
    quoteAirportCheckout: () => ({
      quote: {
        fareBeforeCreditsCents: 4500,
        breakdown: { base_cents: 4500 },
      },
      surge: { multiplier: 1.0 },
    }),
    planSettlement: async () => ({
      cashCents: 0,
      creditsDebitedCents: 4500,
      riderPaysCents: 0,
      creditDiscountCents: 0,
      debits: [{ lotId: 'lot_1', debitCents: 4500 }],
    }),
    debitLots: async () => {
      debitedLotsCalled = true
    },
    insertChargePayment: async () => {
      chargePaymentCalled = true
    },
  }

  // Rejects unknown airport
  const resBadAirport = mockRes()
  await airportCheckoutHandler(
    { method: 'POST', body: JSON.stringify({ airport: 'UNKNOWN_AIRPORT' }) },
    resBadAirport,
    deps
  )
  assert.equal(resBadAirport.statusCode, 400)
  assert.equal(parseResJson(resBadAirport).error, 'Unknown airport')

  // Accepts airport with whitespace and lowercase
  const resGood = mockRes()
  await airportCheckoutHandler(
    { method: 'POST', body: JSON.stringify({ airport: '  gsp  ', useCredits: true }) },
    resGood,
    deps
  )
  assert.equal(resGood.statusCode, 200)
  const bodyGood = parseResJson(resGood)
  assert.equal(bodyGood.paidWithCredits, true)
  assert.equal(bodyGood.airport, 'GSP')
  assert.equal(bodyGood.dueAtTripEndCents, 0)
  assert.equal(debitedLotsCalled, true)
  assert.equal(chargePaymentCalled, true)

  const createdTrip = sb.trips.get(bodyGood.tripId)
  assert.ok(createdTrip)
  assert.equal(createdTrip.status, 'searching')
  assert.equal(createdTrip.metadata.credits_applied, true)
  assert.equal(createdTrip.metadata.due_at_trip_end_cents, 0)
})

test('GA99: airportCheckoutHandler rolls back trip if credit debiting fails', async () => {
  const sb = createMockSb()
  const deps = {
    sb,
    user: { id: 'rider_99', email: 'test@clemson.edu' },
    ensureProfile: async () => ({ ok: true }),
    computeRoutes: async () => ({ distanceM: 70000, durationS: 3000 }),
    loadGameDayMultiplier: async () => ({ multiplier: 1.0 }),
    tigerPassBpsForRider: async () => 0,
    quoteAirportCheckout: () => ({
      quote: { fareBeforeCreditsCents: 4500, breakdown: {} },
      surge: { multiplier: 1.0 },
    }),
    planSettlement: async () => ({
      cashCents: 0,
      creditsDebitedCents: 4500,
      riderPaysCents: 0,
      debits: [{ lotId: 'lot_1', debitCents: 4500 }],
    }),
    debitLots: async () => {
      throw new Error('insufficient_credits')
    },
  }

  const res = mockRes()
  await airportCheckoutHandler(
    { method: 'POST', body: JSON.stringify({ airport: 'CLT' }) },
    res,
    deps
  )
  assert.equal(res.statusCode, 409)
  assert.equal(parseResJson(res).error, 'insufficient_credits')

  // Check trip was canceled
  const trips = [...sb.trips.values()]
  assert.equal(trips.length, 1)
  assert.equal(trips[0].status, 'canceled')
  assert.ok(trips[0].canceled_at)
})

test('GA99: expireUnpaidAirportHolds parses sweep limit and TTL from req.body', () => {
  // Limit from body
  assert.equal(parseHoldSweepLimit({ body: { limit: 15 } }), 15)
  assert.equal(parseHoldSweepLimit({ body: { limit: 100 } }), 40) // capped at 40
  assert.equal(parseHoldSweepLimit({ body: {} }), 40) // default 40

  // TTL from body ttl_ms
  assert.equal(parseHoldSweepTtlMs({ body: { ttl_ms: 1800000 } }), 1800000)
  // TTL from body ttl_seconds
  assert.equal(parseHoldSweepTtlMs({ body: { ttl_seconds: 1200 } }), 1200000)
  // Floor and ceiling
  assert.equal(parseHoldSweepTtlMs({ body: { ttl_ms: 60000 } }), 15 * 60 * 1000) // floored to 15m
})
