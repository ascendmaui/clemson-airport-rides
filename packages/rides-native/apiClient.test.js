import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { apiBase, authedJson } from './apiClient.js'
import { DEFAULT_API_BASE } from './apiOrigin.js'
import {
  AUTH_REQUIRED_COPY,
  GENERIC_ERROR_COPY,
  UNAVAILABLE_COPY,
} from './apiErrors.js'

const originalFetch = globalThis.fetch
const originalEnvApiBase = process.env.EXPO_PUBLIC_API_BASE

beforeEach(() => {
  if (originalEnvApiBase === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE
  } else {
    process.env.EXPO_PUBLIC_API_BASE = originalEnvApiBase
  }
  globalThis.fetch = originalFetch
})

afterEach(() => {
  if (originalEnvApiBase === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE
  } else {
    process.env.EXPO_PUBLIC_API_BASE = originalEnvApiBase
  }
  globalThis.fetch = originalFetch
})

function mockResponse({ ok = true, status = 200, text = '', json = null }) {
  const bodyText = json !== null ? JSON.stringify(json) : text
  return {
    ok,
    status,
    text: async () => bodyText,
  }
}

// ---------------------------------------------------------------------------
// apiBase()
// ---------------------------------------------------------------------------

test('apiBase returns default vercel production URL when EXPO_PUBLIC_API_BASE is unset', () => {
  delete process.env.EXPO_PUBLIC_API_BASE
  // DEFAULT_API_BASE is WEB_ORIGIN from shared/productLinks.js, via apiOrigin.js.
  assert.equal(DEFAULT_API_BASE, 'https://clemson-rides.vercel.app')
  assert.equal(apiBase(), DEFAULT_API_BASE)
})

test('apiBase returns default URL when EXPO_PUBLIC_API_BASE is empty string', () => {
  process.env.EXPO_PUBLIC_API_BASE = ''
  assert.equal(apiBase(), DEFAULT_API_BASE)
})

test('apiBase returns configured base URL without trailing slash', () => {
  process.env.EXPO_PUBLIC_API_BASE = 'https://custom-api.example.com'
  assert.equal(apiBase(), 'https://custom-api.example.com')

  process.env.EXPO_PUBLIC_API_BASE = 'https://custom-api.example.com/'
  assert.equal(apiBase(), 'https://custom-api.example.com')
})

test('apiBase strips every trailing slash from EXPO_PUBLIC_API_BASE', () => {
  // resolveApiBase uses /\/+$/; multiple trailing slashes collapse to none.
  process.env.EXPO_PUBLIC_API_BASE = 'https://custom-api.example.com//'
  assert.equal(apiBase(), 'https://custom-api.example.com')
})

// ---------------------------------------------------------------------------
// authedJson - URL resolution
// ---------------------------------------------------------------------------

test('authedJson resolves relative path against apiBase', async () => {
  delete process.env.EXPO_PUBLIC_API_BASE
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = url
    return mockResponse({ json: { ok: true } })
  }

  const res = await authedJson(null, '/api/trips')
  assert.deepEqual(res, { ok: true })
  assert.equal(requestedUrl, `${DEFAULT_API_BASE}/api/trips`)
})

test('authedJson keeps absolute http and https URLs without prepending apiBase', async () => {
  const requestedUrls = []
  globalThis.fetch = async (url) => {
    requestedUrls.push(url)
    return mockResponse({ json: { ok: true } })
  }

  await authedJson(null, 'https://external-service.com/webhook')
  await authedJson(null, 'http://localhost:3000/api/mock')

  assert.equal(requestedUrls[0], 'https://external-service.com/webhook')
  assert.equal(requestedUrls[1], 'http://localhost:3000/api/mock')
})

test('authedJson path without leading slash concatenates directly onto apiBase', async () => {
  delete process.env.EXPO_PUBLIC_API_BASE
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = url
    return mockResponse({ json: { ok: true } })
  }

  // apiClient joins with `${apiBase()}${path}` and does not insert a slash.
  const path = 'api/trips'
  await authedJson(null, path)
  assert.equal(apiBase(), DEFAULT_API_BASE)
  assert.equal(requestedUrl, `${apiBase()}${path}`)
})

// ---------------------------------------------------------------------------
// authedJson - Auth token injection
// ---------------------------------------------------------------------------

test('authedJson injects Bearer token into Authorization header when session exists', async () => {
  let capturedHeaders
  globalThis.fetch = async (url, options) => {
    capturedHeaders = options.headers
    return mockResponse({ json: { authenticated: true } })
  }

  const mockSupabase = {
    auth: {
      getSession: async () => ({
        data: {
          session: { access_token: 'valid-jwt-token-123' },
        },
      }),
    },
  }

  await authedJson(mockSupabase, '/api/profile')
  assert.equal(capturedHeaders.Authorization, 'Bearer valid-jwt-token-123')
  assert.equal(capturedHeaders['Content-Type'], 'application/json')
  assert.equal(capturedHeaders.Accept, 'application/json')
})

test('authedJson omits Authorization header when supabase is null or undefined', async () => {
  let capturedHeaders
  globalThis.fetch = async (url, options) => {
    capturedHeaders = options.headers
    return mockResponse({ json: { public: true } })
  }

  await authedJson(null, '/api/public')
  assert.equal(capturedHeaders.Authorization, undefined)

  await authedJson(undefined, '/api/public')
  assert.equal(capturedHeaders.Authorization, undefined)
})

test('authedJson omits Authorization header when session or access_token is missing', async () => {
  let capturedHeaders
  globalThis.fetch = async (url, options) => {
    capturedHeaders = options.headers
    return mockResponse({ json: {} })
  }

  const supabaseNoSession = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }
  await authedJson(supabaseNoSession, '/api/test')
  assert.equal(capturedHeaders.Authorization, undefined)

  const supabaseNoData = {
    auth: {
      getSession: async () => ({ data: null }),
    },
  }
  await authedJson(supabaseNoData, '/api/test')
  assert.equal(capturedHeaders.Authorization, undefined)

  const supabaseEmptyToken = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: '' } } }),
    },
  }
  await authedJson(supabaseEmptyToken, '/api/test')
  assert.equal(capturedHeaders.Authorization, undefined)
})

test('authedJson continues without a token when getSession throws', async () => {
  let capturedHeaders
  globalThis.fetch = async (_url, options) => {
    capturedHeaders = options.headers
    return mockResponse({ json: { ok: true } })
  }

  const brokenSupabase = {
    auth: {
      getSession: async () => {
        throw new Error('Auth storage locked')
      },
    },
  }

  const res = await authedJson(brokenSupabase, '/api/test')
  assert.deepEqual(res, { ok: true })
  assert.equal(capturedHeaders.Authorization, undefined)
})

// ---------------------------------------------------------------------------
// authedJson - Methods, body, and headers
// ---------------------------------------------------------------------------

test('authedJson defaults method to GET with undefined body in fetch options', async () => {
  let capturedOptions
  globalThis.fetch = async (url, options) => {
    capturedOptions = options
    return mockResponse({ json: {} })
  }

  await authedJson(null, '/api/status')
  assert.equal(capturedOptions.method, 'GET')
  assert.equal(capturedOptions.body, undefined)
  // BUG?: sends Content-Type: application/json on GET requests with undefined body
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json')
  assert.equal(capturedOptions.headers.Accept, 'application/json')
})

test('authedJson serializes body to JSON string for POST and PATCH', async () => {
  let capturedOptions
  globalThis.fetch = async (url, options) => {
    capturedOptions = options
    return mockResponse({ json: { created: true } })
  }

  const payload = { tripId: 'trip-1', seats: 2 }
  await authedJson(null, '/api/trips', { method: 'POST', body: payload })
  assert.equal(capturedOptions.method, 'POST')
  assert.equal(capturedOptions.body, JSON.stringify(payload))

  await authedJson(null, '/api/trips/1', { method: 'PATCH', body: { seats: 3 } })
  assert.equal(capturedOptions.method, 'PATCH')
  assert.equal(capturedOptions.body, JSON.stringify({ seats: 3 }))
})

test('authedJson treats body null and undefined identically as undefined in fetch options', async () => {
  const capturedBodies = []
  globalThis.fetch = async (url, options) => {
    capturedBodies.push(options.body)
    return mockResponse({ json: {} })
  }

  await authedJson(null, '/api/test1', { body: null })
  await authedJson(null, '/api/test2', { body: undefined })
  assert.equal(capturedBodies[0], undefined)
  assert.equal(capturedBodies[1], undefined)
})

// ---------------------------------------------------------------------------
// authedJson - Happy path responses
// ---------------------------------------------------------------------------

test('authedJson returns parsed JSON object on 200 OK', async () => {
  globalThis.fetch = async () => mockResponse({ json: { trip_id: 't-100', fare: 4500 } })
  const result = await authedJson(null, '/api/fare')
  assert.deepEqual(result, { trip_id: 't-100', fare: 4500 })
})

test('authedJson returns empty object on 200 or 204 with empty response text', async () => {
  globalThis.fetch = async () => mockResponse({ ok: true, status: 204, text: '' })
  const result = await authedJson(null, '/api/delete', { method: 'DELETE' })
  assert.deepEqual(result, {})
})

// ---------------------------------------------------------------------------
// authedJson - Non-2xx error handling and error shapes
// ---------------------------------------------------------------------------

test('authedJson throws error with data.error message and status on 400', async () => {
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 400,
    json: { error: 'Pickup location required', failure: 'missing_pickup' },
  })

  await assert.rejects(
    () => authedJson(null, '/api/request-ride'),
    (err) => {
      assert.equal(err.message, 'Pickup location required')
      assert.equal(err.status, 400)
      assert.equal(err.failure, 'missing_pickup')
      assert.deepEqual(err.payload, { error: 'Pickup location required', failure: 'missing_pickup' })
      assert.equal(err.unavailable, undefined)
      return true
    },
  )
})

test('authedJson uses the auth-required copy on 401 and keeps the payload', async () => {
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 401,
    json: { message: 'Invalid credentials' },
  })

  await assert.rejects(
    () => authedJson(null, '/api/auth'),
    (err) => {
      assert.equal(err.message, AUTH_REQUIRED_COPY)
      assert.equal(err.status, 401)
      assert.equal(err.kind, 'auth')
      assert.equal(err.auth, true)
      assert.equal(err.failure, null)
      assert.equal(err.unavailable, undefined)
      assert.deepEqual(err.payload, { message: 'Invalid credentials' })
      return true
    },
  )
})

test('authedJson uses the generic copy when a 422 body has no user-facing message', async () => {
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 422,
    json: { detail: 'Unprocessable Entity' },
  })

  // detail is not a message field, so friendlyApiError does not surface it.
  await assert.rejects(
    () => authedJson(null, '/api/validate'),
    (err) => {
      assert.equal(err.message, GENERIC_ERROR_COPY)
      assert.equal(err.status, 422)
      assert.equal(err.kind, 'generic')
      assert.equal(err.failure, null)
      assert.equal(err.unavailable, undefined)
      assert.deepEqual(err.payload, { detail: 'Unprocessable Entity' })
      return true
    },
  )
})

test('authedJson marks 404 and 503 errors as unavailable: true', async () => {
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 404,
    json: { error: 'Endpoint not found' },
  })

  await assert.rejects(
    () => authedJson(null, '/api/missing'),
    (err) => {
      assert.equal(err.status, 404)
      assert.equal(err.unavailable, true)
      assert.equal(err.message, 'Endpoint not found')
      return true
    },
  )

  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 503,
    json: { error: 'Service under maintenance' },
  })

  await assert.rejects(
    () => authedJson(null, '/api/rides'),
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.unavailable, true)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.equal(err.code, 'Service under maintenance')
      return true
    },
  )
})

test('authedJson does not set unavailable: true on 500 with valid JSON', async () => {
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 500,
    json: { error: 'Internal server crash' },
  })

  await assert.rejects(
    () => authedJson(null, '/api/crash'),
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.kind, 'server')
      assert.equal(err.unavailable, undefined)
      assert.equal(err.message, GENERIC_ERROR_COPY)
      assert.equal(err.code, 'Internal server crash')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// authedJson - JSON parse failures
// ---------------------------------------------------------------------------

test('authedJson maps a non-OK non-JSON body through friendlyApiError', async () => {
  const html = '<html><body>502 Bad Gateway</body></html>'
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 502,
    text: html,
  })

  await assert.rejects(
    () => authedJson(null, '/api/proxy'),
    (err) => {
      assert.equal(err.message, GENERIC_ERROR_COPY)
      assert.equal(err.kind, 'server')
      assert.equal(err.unavailable, undefined)
      assert.equal(err.status, 502)
      assert.deepEqual(err.payload, { message: html })
      return true
    },
  )
})

test('authedJson throws API unavailable with status 200 when response is 200 OK but non-JSON HTML', async () => {
  globalThis.fetch = async () => mockResponse({
    ok: true,
    status: 200,
    text: '<!DOCTYPE html><html>Captive Portal</html>',
  })

  // BUG?: 200 OK with non-JSON body throws Error('API unavailable') with status 200
  await assert.rejects(
    () => authedJson(null, '/api/wifi-portal'),
    (err) => {
      assert.equal(err.message, 'API unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.status, 200)
      return true
    },
  )
})

test('authedJson maps malformed JSON on a non-OK response through friendlyApiError', async () => {
  const text = '{ broken json '
  globalThis.fetch = async () => mockResponse({
    ok: false,
    status: 500,
    text,
  })

  await assert.rejects(
    () => authedJson(null, '/api/broken'),
    (err) => {
      assert.equal(err.message, GENERIC_ERROR_COPY)
      assert.equal(err.kind, 'server')
      assert.equal(err.unavailable, undefined)
      assert.equal(err.status, 500)
      assert.deepEqual(err.payload, { message: text })
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// authedJson - Network errors
// ---------------------------------------------------------------------------

test('authedJson wraps fetch rejection into network error with message', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }

  await assert.rejects(
    () => authedJson(null, '/api/offline'),
    (err) => {
      assert.equal(err.message, 'Failed to fetch')
      assert.equal(err.network, true)
      return true
    },
  )
})

test('authedJson uses fallback "Network error" message when caught error has no message', async () => {
  globalThis.fetch = async () => {
    throw new Error('')
  }

  await assert.rejects(
    () => authedJson(null, '/api/blank-err'),
    (err) => {
      assert.equal(err.message, 'Network error')
      assert.equal(err.network, true)
      return true
    },
  )

  globalThis.fetch = async () => {
    throw null
  }

  await assert.rejects(
    () => authedJson(null, '/api/null-err'),
    (err) => {
      assert.equal(err.message, 'Network error')
      assert.equal(err.network, true)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// authedJson - Missing or invalid arguments
// ---------------------------------------------------------------------------

test('authedJson works when third argument options is omitted entirely', async () => {
  let capturedOptions
  globalThis.fetch = async (url, options) => {
    capturedOptions = options
    return mockResponse({ json: { ok: true } })
  }

  const result = await authedJson(null, '/api/default-opts')
  assert.deepEqual(result, { ok: true })
  assert.equal(capturedOptions.method, 'GET')
  assert.equal(capturedOptions.body, undefined)
})

test('authedJson crashes with TypeError when path is undefined or null', async () => {
  // BUG?: missing or non-string path throws uncaught TypeError before fetch
  await assert.rejects(
    () => authedJson(null, undefined),
    TypeError,
  )

  await assert.rejects(
    () => authedJson(null, null),
    TypeError,
  )
})

test('authedJson continues when supabase has no getSession function', async () => {
  const calls = []
  globalThis.fetch = async (_url, options) => {
    calls.push(options.headers.Authorization)
    return mockResponse({ json: { ok: true } })
  }

  assert.deepEqual(await authedJson({}, '/api/test'), { ok: true })
  assert.deepEqual(await authedJson({ auth: {} }, '/api/test'), { ok: true })
  assert.deepEqual(calls, [undefined, undefined])
})

test('authedJson lets JSON.stringify throw before fetch when the body is circular', async () => {
  let fetchCalled = false
  globalThis.fetch = async () => {
    fetchCalled = true
    return mockResponse({ json: {} })
  }

  const circular = {}
  circular.self = circular

  await assert.rejects(
    () => authedJson(null, '/api/circular', { body: circular }),
    (err) => {
      assert.equal(err instanceof TypeError, true)
      assert.match(err.message, /Converting circular structure to JSON/)
      assert.equal(err.network, undefined)
      return true
    },
  )
  assert.equal(fetchCalled, false)
})
