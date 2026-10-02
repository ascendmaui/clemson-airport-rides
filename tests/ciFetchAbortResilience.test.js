import assert from 'node:assert/strict'
import test, { after, describe } from 'node:test'
import { authedJson as authedJsonNative } from '../packages/rides-native/apiClient.js'
import { authedJson as authedJsonWeb } from '../src/lib/apiClient.js'

describe('CI fetch abort resilience and signal propagation', () => {
  const origFetch = globalThis.fetch

  after(() => {
    globalThis.fetch = origFetch
  })

  test('native authedJson forwards signal to fetch and preserves AbortError', async () => {
    const controller = new AbortController()
    let receivedSignal = null

    const mockFetch = async (_url, options) => {
      receivedSignal = options?.signal
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }

    controller.abort()

    await assert.rejects(
      () =>
        authedJsonNative(null, '/api/test-route', {
          fetch: mockFetch,
          signal: controller.signal,
        }),
      (err) => {
        assert.equal(err.name, 'AbortError')
        assert.ok(!err.network, 'AbortError should not be marked as a generic network error')
        return true
      },
    )

    assert.equal(receivedSignal, controller.signal)
  })

  test('web authedJson forwards signal to fetch and preserves AbortError', async () => {
    const controller = new AbortController()
    let receivedSignal = null

    const mockFetch = async (_url, options) => {
      receivedSignal = options?.signal
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }

    controller.abort()

    await assert.rejects(
      () =>
        authedJsonWeb(null, '/api/test-route', {
          fetch: mockFetch,
          signal: controller.signal,
        }),
      (err) => {
        assert.equal(err.name, 'AbortError')
        assert.ok(!err.network, 'AbortError should not be marked as a generic network error')
        return true
      },
    )

    assert.equal(receivedSignal, controller.signal)
  })

  test('preserves TimeoutError when fetch aborts due to signal timeout', async () => {
    const mockFetch = async () => {
      const err = new Error('The operation timed out')
      err.name = 'TimeoutError'
      throw err
    }

    await assert.rejects(
      () => authedJsonNative(null, '/api/slow', { fetch: mockFetch }),
      (err) => {
        assert.equal(err.name, 'TimeoutError')
        return true
      },
    )

    await assert.rejects(
      () => authedJsonWeb(null, '/api/slow', { fetch: mockFetch }),
      (err) => {
        assert.equal(err.name, 'TimeoutError')
        return true
      },
    )
  })

  test('propagates signal into 401 token refresh retry fetch', async () => {
    const controller = new AbortController()
    let attempt = 0
    let retrySignal = null

    const mockFetch = async (_url, options) => {
      attempt++
      if (attempt === 1) {
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: 'jwt expired' }),
        }
      }
      retrySignal = options?.signal
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      }
    }

    const mockSupabase = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'stale' } } }),
        refreshSession: async () => ({ data: { session: { access_token: 'fresh' } } }),
      },
    }

    const res = await authedJsonNative(mockSupabase, '/api/retry-test', {
      fetch: mockFetch,
      signal: controller.signal,
    })

    assert.equal(res.success, true)
    assert.equal(attempt, 2)
    assert.equal(retrySignal, controller.signal)
  })
})
