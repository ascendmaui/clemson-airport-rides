import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleStripeSetupIntent,
  handleStripeSavePaymentMethod,
  handleListSavedPaymentMethods,
  handleUpdateSavedPaymentMethod,
} from '../server/stripePaymentRoutes.js'
import stripePaymentMethodsHandler from '../api/stripe-payment-methods.js'

function createFakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val
    },
    end(data) {
      this.body = data
    },
    get json() {
      try {
        return JSON.parse(this.body)
      } catch {
        return null
      }
    },
  }
}

function createFakeRequest({ method = 'GET', url = '/api/stripe-payment-methods', body = null, headers = {} } = {}) {
  return {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  }
}

function mockSb(initialTables = {}) {
  const tables = {
    profiles: [],
    ...initialTables,
  }

  return {
    _tables: tables,
    from(table) {
      if (!tables[table]) tables[table] = []
      const filters = []

      const chain = {
        select() {
          return chain
        },
        eq(col, val) {
          filters.push({ col, op: 'eq', val })
          return chain
        },
        async maybeSingle() {
          const rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              return true
            })
          )
          return { data: rows[0] || null, error: null }
        },
        async single() {
          const res = await chain.maybeSingle()
          if (!res.data) return { data: null, error: { message: 'Row not found' } }
          return res
        },
        upsert(row) {
          const idx = tables[table].findIndex((r) => r.id === row.id)
          if (idx >= 0) {
            tables[table][idx] = { ...tables[table][idx], ...row }
          } else {
            tables[table].push({ ...row })
          }
          return {
            select() {
              return {
                single: async () => ({
                  data: tables[table].find((r) => r.id === row.id) || row,
                  error: null,
                }),
              }
            },
          }
        },
        update(patch) {
          return {
            eq(col, val) {
              const matched = tables[table].filter((r) => r[col] === val)
              for (const row of matched) {
                Object.assign(row, patch)
              }
              return Promise.resolve({ data: matched, error: null })
            },
          }
        },
      }

      return chain
    },
  }
}

function mockStripe(overrides = {}) {
  return {
    customers: {
      async create(params) {
        return { id: 'cus_testCreated123', ...params }
      },
      async update(customerId, params) {
        return { id: customerId, ...params }
      },
      ...(overrides.customers || {}),
    },
    setupIntents: {
      async create(params) {
        return {
          id: 'seti_testCreated123',
          client_secret: 'seti_testCreated123_secret_abc',
          status: 'requires_payment_method',
          ...params,
        }
      },
      async retrieve(id) {
        return {
          id,
          status: 'succeeded',
          payment_method: 'pm_testCard123',
        }
      },
      ...(overrides.setupIntents || {}),
    },
    checkout: {
      sessions: {
        async create(params) {
          return {
            id: 'cs_testSession123',
            url: 'https://checkout.stripe.com/c/pay/cs_testSession123',
            ...params,
          }
        },
        async retrieve(id) {
          return {
            id,
            mode: 'setup',
            status: 'complete',
            customer: 'cus_test123',
            setup_intent: 'seti_testCreated123',
            metadata: { profile_id: 'user-test-123' },
          }
        },
        ...(overrides.checkout?.sessions || {}),
      },
    },
    paymentMethods: {
      async retrieve(id) {
        return {
          id,
          type: 'card',
          card: { brand: 'visa', last4: '4242' },
          customer: 'cus_test123',
        }
      },
      async list({ customer, type }) {
        if (type !== 'card') return { data: [] }
        return {
          data: [
            {
              id: 'pm_testCard123',
              type: 'card',
              card: { brand: 'visa', last4: '4242' },
              customer,
            },
          ],
        }
      },
      async detach(id) {
        return { id }
      },
      ...(overrides.paymentMethods || {}),
    },
  }
}

test('handleStripeSetupIntent: rejects bad method, missing stripe, missing sb, unauth', async () => {
  const reqGet = createFakeRequest({ method: 'GET' })
  const resGet = createFakeResponse()
  await handleStripeSetupIntent(reqGet, resGet, { stripeOk: () => true })
  assert.equal(resGet.statusCode, 405)

  const reqPost = createFakeRequest({ method: 'POST' })
  const resNoStripe = createFakeResponse()
  await handleStripeSetupIntent(reqPost, resNoStripe, { stripeOk: () => false })
  assert.equal(resNoStripe.statusCode, 503)
  assert.equal(resNoStripe.json.error, 'Payments unavailable')

  const resNoSb = createFakeResponse()
  await handleStripeSetupIntent(reqPost, resNoSb, { stripeOk: () => true, sb: null })
  assert.equal(resNoSb.statusCode, 503)
  assert.equal(resNoSb.json.error, 'SUPABASE_SERVICE_ROLE_KEY not configured')

  const resNoUser = createFakeResponse()
  await handleStripeSetupIntent(reqPost, resNoUser, { stripeOk: () => true, sb: mockSb(), user: null })
  assert.equal(resNoUser.statusCode, 401)
  assert.equal(resNoUser.json.error, 'Sign in required')
})

test('handleStripeSetupIntent: creates setup intent and creates stripe customer if none exists', async () => {
  const sb = mockSb({
    profiles: [{ id: 'user-1', email: 'user1@clemson.edu', stripe_customer_id: null }],
  })
  const stripe = mockStripe()
  const req = createFakeRequest({
    method: 'POST',
    body: { paymentMethod: 'card' },
  })
  const res = createFakeResponse()

  await handleStripeSetupIntent(req, res, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-1', email: 'user1@clemson.edu' },
    stripe,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.json.setupIntentId, 'seti_testCreated123')
  assert.equal(res.json.customerId, 'cus_testCreated123')
  assert.ok(Array.isArray(res.json.paymentMethodTypes))
})

test('handleStripeSetupIntent: creates checkout setup session when body.checkout is true', async () => {
  const sb = mockSb({
    profiles: [{ id: 'user-2', email: 'user2@clemson.edu', stripe_customer_id: 'cus_testExisting222' }],
  })
  const stripe = mockStripe()
  const req = createFakeRequest({
    method: 'POST',
    body: { checkout: true, returnUrl: 'https://clemsonairportrides.com/account' },
  })
  const res = createFakeResponse()

  await handleStripeSetupIntent(req, res, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-2', email: 'user2@clemson.edu' },
    stripe,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.json.sessionId, 'cs_testSession123')
  assert.ok(res.json.url.startsWith('https://checkout.stripe.com/'))
  assert.equal(res.json.customerId, 'cus_testExisting222')
})

test('handleStripeSavePaymentMethod: rejects bad method, missing stripe, missing sb, unauth, missing identifiers', async () => {
  const reqGet = createFakeRequest({ method: 'GET' })
  const resGet = createFakeResponse()
  await handleStripeSavePaymentMethod(reqGet, resGet, { stripeOk: () => true })
  assert.equal(resGet.statusCode, 405)

  const reqPost = createFakeRequest({ method: 'POST', body: {} })
  const resNoStripe = createFakeResponse()
  await handleStripeSavePaymentMethod(reqPost, resNoStripe, { stripeOk: () => false })
  assert.equal(resNoStripe.statusCode, 503)

  const resNoSb = createFakeResponse()
  await handleStripeSavePaymentMethod(reqPost, resNoSb, { stripeOk: () => true, sb: null })
  assert.equal(resNoSb.statusCode, 503)

  const resNoUser = createFakeResponse()
  await handleStripeSavePaymentMethod(reqPost, resNoUser, { stripeOk: () => true, sb: mockSb(), user: null })
  assert.equal(resNoUser.statusCode, 401)

  const resMissingIds = createFakeResponse()
  await handleStripeSavePaymentMethod(reqPost, resMissingIds, {
    stripeOk: () => true,
    sb: mockSb(),
    user: { id: 'user-3', email: 'user3@clemson.edu' },
    stripe: mockStripe(),
  })
  assert.equal(resMissingIds.statusCode, 400)
  assert.equal(resMissingIds.json.error, 'paymentMethodId or setupIntentId required')
})

test('handleStripeSavePaymentMethod: validates checkout session and setup intent status', async () => {
  const sb = mockSb({
    profiles: [{ id: 'user-4', email: 'user4@clemson.edu', stripe_customer_id: 'cus_test123' }],
  })
  const stripeIncompleteSession = mockStripe({
    checkout: {
      sessions: {
        async retrieve() {
          return { mode: 'setup', status: 'open' }
        },
      },
    },
  })
  const req1 = createFakeRequest({ method: 'POST', body: { checkoutSessionId: 'cs_testOpen' } })
  const res1 = createFakeResponse()
  await handleStripeSavePaymentMethod(req1, res1, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-4' },
    stripe: stripeIncompleteSession,
  })
  assert.equal(res1.statusCode, 400)
  assert.equal(res1.json.error, 'Setup checkout is not complete')

  const stripeCrossAccount = mockStripe({
    checkout: {
      sessions: {
        async retrieve() {
          return {
            mode: 'setup',
            status: 'complete',
            metadata: { profile_id: 'other-user' },
          }
        },
      },
    },
  })
  const resCross = createFakeResponse()
  await handleStripeSavePaymentMethod(req1, resCross, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-4' },
    stripe: stripeCrossAccount,
  })
  assert.equal(resCross.statusCode, 403)
  assert.equal(resCross.json.error, 'Setup session does not belong to this account')

  const stripeIncompleteSi = mockStripe({
    setupIntents: {
      async retrieve() {
        return { status: 'requires_action' }
      },
    },
  })
  const req2 = createFakeRequest({ method: 'POST', body: { setupIntentId: 'seti_testIncomplete' } })
  const res2 = createFakeResponse()
  await handleStripeSavePaymentMethod(req2, res2, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-4' },
    stripe: stripeIncompleteSi,
  })
  assert.equal(res2.statusCode, 400)
  assert.match(res2.json.error, /SetupIntent status requires_action/)
})

test('handleStripeSavePaymentMethod: saves payment method directly and updates default pm on profile', async () => {
  const sb = mockSb({
    profiles: [{ id: 'user-5', email: 'user5@clemson.edu', stripe_customer_id: 'cus_test123' }],
  })
  let customerUpdated = false
  const stripe = mockStripe({
    customers: {
      async update(cid, params) {
        if (cid === 'cus_test123' && params?.invoice_settings?.default_payment_method === 'pm_testCard123') {
          customerUpdated = true
        }
        return { id: cid }
      },
    },
  })

  const req = createFakeRequest({ method: 'POST', body: { paymentMethodId: 'pm_testCard123' } })
  const res = createFakeResponse()
  await handleStripeSavePaymentMethod(req, res, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-5' },
    stripe,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.paymentMethodId, 'pm_testCard123')
  assert.equal(res.json.brand, 'visa')
  assert.equal(res.json.last4, '4242')
  assert.equal(customerUpdated, true)

  const profile = sb._tables.profiles.find((p) => p.id === 'user-5')
  assert.equal(profile.stripe_default_pm_id, 'pm_testCard123')
  assert.equal(profile.stripe_card_brand, 'visa')
  assert.equal(profile.stripe_card_last4, '4242')
  assert.ok(profile.billing_activated_at)
})

test('handleListSavedPaymentMethods: lists methods for existing customer, handles empty/no customer', async () => {
  const sb = mockSb({
    profiles: [
      { id: 'user-no-cust', email: 'none@clemson.edu', stripe_customer_id: null },
      { id: 'user-with-cust', email: 'with@clemson.edu', stripe_customer_id: 'cus_test123', stripe_default_pm_id: 'pm_testCard123' },
    ],
  })
  const stripe = mockStripe()

  const req1 = createFakeRequest({ method: 'GET' })
  const res1 = createFakeResponse()
  await handleListSavedPaymentMethods(req1, res1, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-no-cust' },
    stripe,
  })
  assert.equal(res1.statusCode, 200)
  assert.deepEqual(res1.json.methods, [])
  assert.equal(res1.json.defaultPmId, null)

  const req2 = createFakeRequest({ method: 'GET' })
  const res2 = createFakeResponse()
  await handleListSavedPaymentMethods(req2, res2, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-with-cust' },
    stripe,
  })
  assert.equal(res2.statusCode, 200)
  assert.equal(res2.json.defaultPmId, 'pm_testCard123')
  assert.equal(res2.json.methods.length, 1)
  assert.equal(res2.json.methods[0].id, 'pm_testCard123')
  assert.equal(res2.json.methods[0].last4, '4242')
})

test('handleUpdateSavedPaymentMethod: validates action, PM id, and cross-account protection', async () => {
  const sb = mockSb({
    profiles: [
      { id: 'user-6', email: 'u6@clemson.edu', stripe_customer_id: 'cus_test123', stripe_default_pm_id: 'pm_testCard123' },
      { id: 'user-no-c', email: 'noc@clemson.edu', stripe_customer_id: null },
    ],
  })
  const stripe = mockStripe({
    paymentMethods: {
      async retrieve(id) {
        if (id === 'pm_testForeign') {
          return { id, type: 'card', customer: 'cus_testSomeoneElse' }
        }
        return { id, type: 'card', customer: 'cus_test123', card: { brand: 'mastercard', last4: '5555' } }
      },
    },
  })

  // Bad action
  const reqBadAction = createFakeRequest({ method: 'POST', body: { action: 'delete', paymentMethodId: 'pm_testCard123' } })
  const resBadAction = createFakeResponse()
  await handleUpdateSavedPaymentMethod(reqBadAction, resBadAction, { stripeOk: () => true, sb, user: { id: 'user-6' }, stripe })
  assert.equal(resBadAction.statusCode, 400)
  assert.equal(resBadAction.json.error, 'Unknown payment method action')

  // Bad PM id format
  const reqBadPm = createFakeRequest({ method: 'POST', body: { action: 'default', paymentMethodId: 'invalid_id' } })
  const resBadPm = createFakeResponse()
  await handleUpdateSavedPaymentMethod(reqBadPm, resBadPm, { stripeOk: () => true, sb, user: { id: 'user-6' }, stripe })
  assert.equal(resBadPm.statusCode, 400)
  assert.equal(resBadPm.json.error, 'paymentMethodId required')

  // No customer on profile
  const reqNoCust = createFakeRequest({ method: 'POST', body: { action: 'default', paymentMethodId: 'pm_testCard123' } })
  const resNoCust = createFakeResponse()
  await handleUpdateSavedPaymentMethod(reqNoCust, resNoCust, { stripeOk: () => true, sb, user: { id: 'user-no-c' }, stripe })
  assert.equal(resNoCust.statusCode, 400)
  assert.equal(resNoCust.json.error, 'No payment method on this account')

  // Foreign payment method
  const reqForeign = createFakeRequest({ method: 'POST', body: { action: 'default', paymentMethodId: 'pm_testForeign' } })
  const resForeign = createFakeResponse()
  await handleUpdateSavedPaymentMethod(reqForeign, resForeign, { stripeOk: () => true, sb, user: { id: 'user-6' }, stripe })
  assert.equal(resForeign.statusCode, 403)
  assert.equal(resForeign.json.error, 'That payment method is not on this account')
})

test('handleUpdateSavedPaymentMethod: sets default PM and detaches PM correctly', async () => {
  const sb = mockSb({
    profiles: [
      { id: 'user-7', email: 'u7@clemson.edu', stripe_customer_id: 'cus_test123', stripe_default_pm_id: 'pm_testCard123' },
    ],
  })
  let detachedId = null
  const stripe = mockStripe({
    paymentMethods: {
      async retrieve(id) {
        return { id, type: 'card', customer: 'cus_test123', card: { brand: 'visa', last4: '1111' } }
      },
      async list() {
        return { data: [{ id: 'pm_testCard2', type: 'card', card: { brand: 'visa', last4: '2222' } }] }
      },
      async detach(id) {
        detachedId = id
        return { id }
      },
    },
  })

  // Action default
  const reqDefault = createFakeRequest({ method: 'POST', body: { action: 'default', paymentMethodId: 'pm_testCard1111' } })
  const resDefault = createFakeResponse()
  await handleUpdateSavedPaymentMethod(reqDefault, resDefault, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-7' },
    stripe,
  })
  assert.equal(resDefault.statusCode, 200)
  assert.equal(resDefault.json.ok, true)
  assert.equal(resDefault.json.defaultPmId, 'pm_testCard1111')

  // Action detach
  const reqDetach = createFakeRequest({ method: 'POST', body: { action: 'detach', paymentMethodId: 'pm_testCard1111' } })
  const resDetach = createFakeResponse()
  await handleUpdateSavedPaymentMethod(reqDetach, resDetach, {
    stripeOk: () => true,
    sb,
    user: { id: 'user-7' },
    stripe,
  })
  assert.equal(resDetach.statusCode, 200)
  assert.equal(resDetach.json.ok, true)
  assert.equal(detachedId, 'pm_testCard1111')
})

test('stripePaymentMethodsHandler router: forwards requests to appropriate handlers', async () => {
  const sb = mockSb({
    profiles: [{ id: 'user-router', email: 'router@clemson.edu', stripe_customer_id: null }],
  })
  const stripe = mockStripe()
  const deps = { stripeOk: () => true, sb, user: { id: 'user-router', email: 'router@clemson.edu' }, stripe }

  // GET default -> list
  const reqGet = createFakeRequest({ method: 'GET', url: '/api/stripe-payment-methods' })
  const resGet = createFakeResponse()
  await stripePaymentMethodsHandler(reqGet, resGet, deps)
  assert.equal(resGet.statusCode, 200)
  assert.deepEqual(resGet.json.methods, [])

  // POST action=setup-intent -> setup intent
  const reqSi = createFakeRequest({
    method: 'POST',
    url: '/api/stripe-payment-methods?action=setup-intent',
    body: { paymentMethod: 'card' },
  })
  const resSi = createFakeResponse()
  await stripePaymentMethodsHandler(reqSi, resSi, deps)
  assert.equal(resSi.statusCode, 200)
  assert.equal(resSi.json.setupIntentId, 'seti_testCreated123')

  // POST with body.action = detach -> update
  const reqDetach = createFakeRequest({
    method: 'POST',
    url: '/api/stripe-payment-methods',
    body: { action: 'detach', paymentMethodId: 'invalid' },
  })
  const resDetach = createFakeResponse()
  await stripePaymentMethodsHandler(reqDetach, resDetach, deps)
  assert.equal(resDetach.statusCode, 400)
  assert.equal(resDetach.json.error, 'paymentMethodId required')
})
