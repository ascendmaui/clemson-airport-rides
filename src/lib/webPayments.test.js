import test from 'node:test'
import assert from 'node:assert/strict'
import { api as paymentsApi, collectTripPayment } from './payments.js'
import { createCheckoutSession, abandonCheckoutSession } from './stripeCheckout.js'
import { api as billingApi, buyCreditPack } from './billingApi.js'
import { UNAVAILABLE_COPY, AUTH_REQUIRED_COPY } from './apiErrors.js'

test('src/lib/payments.js: 401 refresh retry succeeds and makes authed request', async () => {
  let fetchCount = 0
  const authHeaders = []
  const fakeFetch = async (url, options) => {
    fetchCount++
    authHeaders.push(options?.headers?.Authorization)
    if (fetchCount === 1) {
      return {
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'jwt expired' }),
      }
    }
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true, collected: 1500 }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-web-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return {
          data: { session: { access_token: 'refreshed-web-token' } },
        }
      },
    },
  }

  const result = await paymentsApi(
    '/api/stripe-payment-methods?action=collect',
    { tripId: 'trip_1' },
    { fetch: fakeFetch, supabase: fakeSupabase }
  )

  assert.deepEqual(result, { ok: true, collected: 1500 })
  assert.equal(fetchCount, 2)
  assert.equal(refreshCount, 1)
})

test('src/lib/payments.js: 503 / config error throws friendly message without refresh', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 503,
      ok: false,
      text: async () => JSON.stringify({
        error: 'Payments unavailable',
        message: 'STRIPE_SECRET_KEY is not configured.',
      }),
    }
  }

  await assert.rejects(
    async () => {
      await paymentsApi(
        '/api/stripe-payment-methods?action=collect',
        { tripId: 'trip_1' },
        { fetch: fakeFetch }
      )
    },
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.equal(err.message, 'Payments are temporarily unavailable, please try again shortly')
      return true
    }
  )

  assert.equal(fetchCount, 1)
})

test('src/lib/payments.js: 500 with SUPABASE_SERVICE_ROLE_KEY missing is mapped to unavailable', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 500,
      ok: false,
      text: async () => JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }),
    }
  }

  await assert.rejects(
    async () => {
      await paymentsApi(
        '/api/driver?action=payouts',
        {},
        { fetch: fakeFetch }
      )
    },
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.message, UNAVAILABLE_COPY)
      return true
    }
  )

  assert.equal(fetchCount, 1)
})

test('src/lib/stripeCheckout.js createCheckoutSession: 401 refresh retry succeeds', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    if (fetchCount === 1) {
      return {
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'jwt expired' }),
      }
    }
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({
        url: 'https://checkout.stripe.com/pay/cs_test_123',
        tripId: 'trip_airport_1',
      }),
    }
  }

  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-token' } },
      }),
      refreshSession: async () => ({
        data: { session: { access_token: 'fresh-token' } },
      }),
    },
  }

  const result = await createCheckoutSession(
    {
      airport: 'GSP',
      riderName: 'Jane',
      tripId: 'trip_airport_1',
      riderId: 'rider_1',
    },
    { fetch: fakeFetch, supabase: fakeSupabase }
  )

  assert.equal(result.url, 'https://checkout.stripe.com/pay/cs_test_123')
  assert.equal(result.tripId, 'trip_airport_1')
  assert.equal(fetchCount, 2)
})

test('src/lib/stripeCheckout.js createCheckoutSession: 503 returns friendly copy and unavailable flag', async () => {
  const fakeFetch = async () => ({
    status: 503,
    ok: false,
    text: async () => JSON.stringify({
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured.',
    }),
  })

  await assert.rejects(
    async () => {
      await createCheckoutSession(
        {
          airport: 'GSP',
          riderName: 'Jane',
          tripId: 'trip_airport_1',
          riderId: 'rider_1',
        },
        { fetch: fakeFetch }
      )
    },
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.equal(err.message, 'Payments are temporarily unavailable, please try again shortly')
      return true
    }
  )
})

test('src/lib/stripeCheckout.js createCheckoutSession: stub/no-url returns friendly unavailable error', async () => {
  const fakeFetch = async () => ({
    status: 200,
    ok: true,
    text: async () => JSON.stringify({
      stub: true,
      message: 'Payments unavailable',
    }),
  })

  await assert.rejects(
    async () => {
      await createCheckoutSession(
        {
          airport: 'GSP',
          riderName: 'Jane',
          tripId: 'trip_airport_1',
          riderId: 'rider_1',
        },
        { fetch: fakeFetch }
      )
    },
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.message, UNAVAILABLE_COPY)
      return true
    }
  )
})

test('src/lib/stripeCheckout.js abandonCheckoutSession: 401 retry and 503 friendly error', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    if (fetchCount === 1) {
      return {
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'jwt expired' }),
      }
    }
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true, released: true }),
    }
  }

  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-token' } },
      }),
      refreshSession: async () => ({
        data: { session: { access_token: 'fresh-token' } },
      }),
    },
  }

  const result = await abandonCheckoutSession(
    { tripId: 'trip_abandon_1', sessionId: 'cs_123' },
    { fetch: fakeFetch, supabase: fakeSupabase }
  )
  assert.deepEqual(result, { ok: true, released: true })
  assert.equal(fetchCount, 2)
})

test('src/lib/billingApi.js: 503 returns friendly copy without leaking config', async () => {
  const fakeFetch = async () => ({
    status: 503,
    ok: false,
    text: async () => JSON.stringify({
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured.',
    }),
  })

  await assert.rejects(
    async () => {
      await billingApi('/api/stripe-payment-methods?action=buy-credits', {
        method: 'POST',
        body: { packId: 'pack_50' },
        fetch: fakeFetch,
      })
    },
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.doesNotMatch(err.message, /STRIPE|KEY|SECRET/i)
      return true
    }
  )
})
