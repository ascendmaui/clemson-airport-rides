import test from 'node:test'
import assert from 'node:assert/strict'
import { authedJson } from './apiClient.js'
import { UNAVAILABLE_COPY, AUTH_REQUIRED_COPY } from './apiErrors.js'

test('src/lib/apiClient authedJson on 401: refresh succeeds -> retried once with new access token', async () => {
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
      text: async () => JSON.stringify({ ok: true, tripId: 'trip_web_123' }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return {
          data: { session: { access_token: 'fresh-token' } },
        }
      },
    },
  }

  const result = await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
    method: 'POST',
    body: { airport: 'GSP' },
    fetch: fakeFetch,
  })

  assert.deepEqual(result, { ok: true, tripId: 'trip_web_123' })
  assert.equal(fetchCount, 2)
  assert.equal(refreshCount, 1)
  assert.equal(authHeaders[0], 'Bearer stale-token')
  assert.equal(authHeaders[1], 'Bearer fresh-token')
})

test('src/lib/apiClient authedJson on 401: refresh fails -> auth error without retry', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 401,
      ok: false,
      text: async () => JSON.stringify({ error: 'Sign in required' }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return {
          data: { session: null },
          error: new Error('Invalid refresh token'),
        }
      },
    },
  }

  await assert.rejects(
    async () => {
      await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
        method: 'POST',
        fetch: fakeFetch,
      })
    },
    (err) => {
      assert.equal(err.status, 401)
      assert.equal(err.kind, 'auth')
      assert.equal(err.auth, true)
      assert.equal(err.message, AUTH_REQUIRED_COPY)
      assert.equal(err.message, 'Please sign in again to continue.')
      return true
    }
  )

  assert.equal(fetchCount, 1)
  assert.equal(refreshCount, 1)
})

test('src/lib/apiClient authedJson on 503 / config error: friendly message, no refresh', async () => {
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

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'valid-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return { data: { session: { access_token: 'new-token' } } }
      },
    },
  }

  await assert.rejects(
    async () => {
      await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
        method: 'POST',
        fetch: fakeFetch,
      })
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
  assert.equal(refreshCount, 0)
})

test('src/lib/apiClient authedJson supports authedJson(path, options) overload', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ credits: 50 }),
    }
  }

  const result = await authedJson('/api/credits', { fetch: fakeFetch })
  assert.deepEqual(result, { credits: 50 })
  assert.equal(fetchCount, 1)
})
