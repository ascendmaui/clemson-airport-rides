import test from 'node:test'
import assert from 'node:assert/strict'
import buyCreditsHandler from '../server/endpoints/buyCredits.js'
import creditsConfirmHandler from '../server/endpoints/creditsConfirm.js'
import creditLotsHandler from '../server/endpoints/creditLots.js'
import stripePaymentHandler from '../api/stripe-payment-methods.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    headersSent: false,
    body: '',
    setHeader(name, value) {
      if (this.headersSent) {
        throw new Error('ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent')
      }
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      if (this.writableEnded) {
        throw new Error('ERR_STREAM_WRITE_AFTER_END: write after end')
      }
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function parseJson(res) {
  try {
    return JSON.parse(res.body || '{}')
  } catch {
    return null
  }
}

test('GA96: buyCredits rejects non-POST methods with 405 and Allow/Cache-Control', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const req = { method, headers: {} }
    const res = mockRes()
    await buyCreditsHandler(req, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers['allow'], 'POST, OPTIONS')
    assert.match(res.headers['cache-control'], /no-store/)
    assert.equal(parseJson(res).error, 'Method not allowed')
  }
})

test('GA96: buyCredits returns 503 when Stripe or Supabase is unconfigured', async () => {
  const req = { method: 'POST', headers: {} }
  // Stripe unconfigured
  const res1 = mockRes()
  await buyCreditsHandler(req, res1, { stripeOk: () => false, stripe: null })
  assert.equal(res1.statusCode, 503)
  assert.equal(parseJson(res1).error, 'Payments unavailable')

  // Supabase unconfigured
  const res2 = mockRes()
  await buyCreditsHandler(req, res2, { stripeOk: () => true, sb: null })
  assert.equal(res2.statusCode, 503)
  assert.equal(parseJson(res2).error, 'SUPABASE_SERVICE_ROLE_KEY not configured')
})

test('GA96: buyCredits validates auth, body parsing, and pack lookup with trimming', async () => {
  // 401 unauthenticated
  const res1 = mockRes()
  await buyCreditsHandler({ method: 'POST', headers: {} }, res1, {
    stripeOk: () => true,
    sb: {},
    user: null,
  })
  assert.equal(res1.statusCode, 401)

  // 400 invalid JSON
  const res2 = mockRes()
  await buyCreditsHandler({ method: 'POST', body: 'invalid-json' }, res2, {
    stripeOk: () => true,
    sb: {},
    user: { id: 'u_1' },
  })
  assert.equal(res2.statusCode, 400)

  // 400 unknown pack
  const res3 = mockRes()
  await buyCreditsHandler({ method: 'POST', body: { packId: 'nonexistent_pack' } }, res3, {
    stripeOk: () => true,
    sb: {},
    user: { id: 'u_1' },
  })
  assert.equal(res3.statusCode, 400)
  assert.equal(parseJson(res3).error, 'Unknown credit pack')
})

test('GA96: buyCredits creates Checkout session with pack metadata and returns 200', async () => {
  const mockPack = { id: 'pack_50', label: '$50 Pack', loadCents: 5000, discountBps: 500 }
  const mockProfile = { id: 'u_1', email: 'rider@clemson.edu', stripe_customer_id: 'cus_test' }
  const mockSb = {
    from: (table) => {
      assert.equal(table, 'profiles')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mockProfile, error: null }),
          }),
        }),
      }
    },
  }

  let sessionCreated = null
  const mockStripe = {
    checkout: {
      sessions: {
        create: async (params) => {
          sessionCreated = params
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' }
        },
      },
    },
  }

  const req = {
    method: 'POST',
    body: { packId: ' pack_50 ' },
  }
  const res = mockRes()

  await buyCreditsHandler(req, res, {
    stripeOk: () => true,
    sb: mockSb,
    user: { id: 'u_1', email: 'rider@clemson.edu' },
    findCreditPack: (id) => (id === 'pack_50' ? mockPack : null),
    stripe: mockStripe,
    ensureStripeCustomer: async () => 'cus_test',
  })

  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /no-store/)
  const body = parseJson(res)
  assert.equal(body.id, 'cs_test_123')
  assert.equal(body.url, 'https://checkout.stripe.com/pay/cs_test_123')
  assert.deepEqual(body.pack, mockPack)

  assert.equal(sessionCreated.mode, 'payment')
  assert.equal(sessionCreated.customer, 'cus_test')
  assert.equal(sessionCreated.metadata.kind, 'credit_purchase')
  assert.equal(sessionCreated.metadata.pack_id, 'pack_50')
  assert.equal(sessionCreated.metadata.load_cents, '5000')
})

test('GA96: creditsConfirm rejects non-POST methods with 405 and Allow/Cache-Control', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const req = { method, headers: {} }
    const res = mockRes()
    await creditsConfirmHandler(req, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers['allow'], 'POST, OPTIONS')
    assert.match(res.headers['cache-control'], /no-store/)
    assert.equal(parseJson(res).error, 'Method not allowed')
  }
})

test('GA96: creditsConfirm validates sessionId and purchase ownership', async () => {
  // Missing sessionId
  const res1 = mockRes()
  await creditsConfirmHandler({ method: 'POST', body: {} }, res1, {
    stripeOk: () => true,
    sb: {},
    user: { id: 'u_1' },
  })
  assert.equal(res1.statusCode, 400)
  assert.equal(parseJson(res1).error, 'sessionId required')

  // Not a credit purchase
  const mockStripeWrongKind = {
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: 'cs_1',
          metadata: { kind: 'airport_deposit' },
        }),
      },
    },
  }
  const res2 = mockRes()
  await creditsConfirmHandler({ method: 'POST', body: { sessionId: 'cs_1' } }, res2, {
    stripeOk: () => true,
    sb: {},
    user: { id: 'u_1' },
    stripe: mockStripeWrongKind,
  })
  assert.equal(res2.statusCode, 400)
  assert.equal(parseJson(res2).error, 'Not a credit purchase')

  // User mismatch
  const mockStripeMismatch = {
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: 'cs_2',
          metadata: { kind: 'credit_purchase', profile_id: 'other_user' },
        }),
      },
    },
  }
  const res3 = mockRes()
  await creditsConfirmHandler({ method: 'POST', body: { sessionId: 'cs_2' } }, res3, {
    stripeOk: () => true,
    sb: {},
    user: { id: 'u_1' },
    stripe: mockStripeMismatch,
  })
  assert.equal(res3.statusCode, 403)
  assert.equal(parseJson(res3).error, 'Not your purchase')

  // Unpaid session
  const mockStripeUnpaid = {
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: 'cs_3',
          metadata: { kind: 'credit_purchase', profile_id: 'u_1' },
          payment_status: 'unpaid',
        }),
      },
    },
  }
  const res4 = mockRes()
  await creditsConfirmHandler({ method: 'POST', body: { sessionId: 'cs_3' } }, res4, {
    stripeOk: () => true,
    sb: {},
    user: { id: 'u_1' },
    stripe: mockStripeUnpaid,
  })
  assert.equal(res4.statusCode, 409)
  assert.equal(parseJson(res4).error, 'Payment not completed')
})

test('GA96: creditsConfirm grants pack and returns 200 on successful payment', async () => {
  const mockSession = {
    id: 'cs_paid_123',
    metadata: { kind: 'credit_purchase', profile_id: 'u_1', pack_id: 'pack_50' },
    payment_status: 'paid',
    payment_intent: 'pi_test_123',
  }
  const mockStripe = {
    checkout: {
      sessions: {
        retrieve: async () => mockSession,
      },
    },
  }

  let grantedPayload = null
  const res = mockRes()
  await creditsConfirmHandler({ method: 'POST', body: { sessionId: ' cs_paid_123 ' } }, res, {
    stripeOk: () => true,
    sb: { from: () => {} },
    user: { id: 'u_1' },
    stripe: mockStripe,
    grantCreditPack: async (sb, params) => {
      grantedPayload = params
      return { lotId: 'lot_1', balanceCents: 5000, grantedCents: 5000 }
    },
  })

  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /no-store/)
  const body = parseJson(res)
  assert.equal(body.ok, true)
  assert.equal(body.lotId, 'lot_1')
  assert.equal(body.balanceCents, 5000)
  assert.equal(grantedPayload.packId, 'pack_50')
  assert.equal(grantedPayload.stripePaymentIntentId, 'pi_test_123')
  assert.equal(grantedPayload.stripeCheckoutSessionId, 'cs_paid_123')
})

test('GA96: creditLots rejects non-GET methods and returns balance and packs', async () => {
  // Method rejection
  const badRes = mockRes()
  await creditLotsHandler({ method: 'POST', headers: {} }, badRes)
  assert.equal(badRes.statusCode, 405)
  assert.equal(badRes.headers['allow'], 'GET, OPTIONS')
  assert.match(badRes.headers['cache-control'], /no-store/)

  // 401 unauthenticated
  const res1 = mockRes()
  await creditLotsHandler({ method: 'GET', headers: {} }, res1, { sb: {}, user: null })
  assert.equal(res1.statusCode, 401)

  // 200 happy path
  const res2 = mockRes()
  await creditLotsHandler({ method: 'GET', headers: {} }, res2, {
    sb: {},
    user: { id: 'u_1' },
    loadCreditLots: async () => [{ id: 'lot_1', remaining_cents: 2500 }],
    creditBalanceCents: async () => 2500,
  })
  assert.equal(res2.statusCode, 200)
  assert.match(res2.headers['cache-control'], /no-store/)
  const body = parseJson(res2)
  assert.equal(body.balanceCents, 2500)
  assert.equal(body.lots.length, 1)
  assert.ok(Array.isArray(body.packs))
})

test('GA96: stripe-payment-methods routes credit actions forwarding dependencies', async () => {
  // buy-credits dispatch
  let buyCalled = false
  const buyReq = { method: 'POST', url: '/api/stripe-payment-methods?action=buy-credits', body: { packId: 'pack_20' } }
  const buyRes = mockRes()
  await stripePaymentHandler(buyReq, buyRes, {
    stripeOk: () => true,
    sb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {} }) }) }) }) },
    user: { id: 'u_1' },
    findCreditPack: () => {
      buyCalled = true
      return { id: 'pack_20', loadCents: 2000, discountBps: 0 }
    },
    stripe: { checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://test' }) } } },
  })
  assert.equal(buyRes.statusCode, 200)
  assert.equal(buyCalled, true)

  // credit-lots dispatch
  let lotsCalled = false
  const lotsReq = { method: 'GET', url: '/api/stripe-payment-methods?action=credit-lots' }
  const lotsRes = mockRes()
  await stripePaymentHandler(lotsReq, lotsRes, {
    sb: {},
    user: { id: 'u_1' },
    loadCreditLots: async () => {
      lotsCalled = true
      return []
    },
    creditBalanceCents: async () => 0,
  })
  assert.equal(lotsRes.statusCode, 200)
  assert.equal(lotsCalled, true)
})
