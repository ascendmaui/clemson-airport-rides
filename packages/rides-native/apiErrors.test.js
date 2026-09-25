import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_REQUIRED_COPY,
  GENERIC_ERROR_COPY,
  NETWORK_ERROR_COPY,
  UNAVAILABLE_COPY,
  friendlyApiError,
  isUserFacing,
} from './apiErrors.js'

test('503 returns kind unavailable with friendly payments copy', () => {
  const r1 = friendlyApiError(503)
  assert.equal(r1.kind, 'unavailable')
  assert.equal(r1.message, UNAVAILABLE_COPY)
  assert.equal(r1.message, 'Payments are temporarily unavailable, please try again shortly')

  const r2 = friendlyApiError(503, { error: 'Service Unavailable' })
  assert.equal(r2.kind, 'unavailable')
  assert.equal(r2.message, UNAVAILABLE_COPY)

  const r3 = friendlyApiError(503, 'Payments unavailable')
  assert.equal(r3.kind, 'unavailable')
  assert.equal(r3.message, UNAVAILABLE_COPY)

  // String status
  const r4 = friendlyApiError('503', null)
  assert.equal(r4.kind, 'unavailable')
  assert.equal(r4.message, UNAVAILABLE_COPY)
})

test('body matching unavailable pattern returns kind unavailable regardless of status', () => {
  const cases = [
    { status: 500, body: 'STRIPE_SECRET_KEY is not configured.' },
    { status: 500, body: { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' } },
    { status: 400, body: { message: 'service role key missing' } },
    { status: 402, body: { message: 'Payments unavailable' } },
    { status: 200, body: { error: 'Payments unavailable' } },
    { status: 500, body: 'Database not configured' },
    { status: undefined, body: 'STRIPE_PUBLISHABLE_KEY is not configured.' },
    { status: 400, body: '{"error":"Payments unavailable","message":"STRIPE_SECRET_KEY is not configured."}' },
  ]

  for (const c of cases) {
    const res = friendlyApiError(c.status, c.body)
    assert.equal(res.kind, 'unavailable')
    assert.equal(res.message, UNAVAILABLE_COPY)
  }
})

test('raw environment variable names never leak in error messages', () => {
  const envBodies = [
    'STRIPE_SECRET_KEY is not configured.',
    'Missing SUPABASE_SERVICE_ROLE_KEY in environment',
    { error: 'STRIPE_WEBHOOK_SECRET is not configured' },
    { message: 'CLERK_SECRET_KEY is missing' },
    { error: 'SUPABASE_ANON_KEY not set' },
    { failure: { message: 'DATABASE_URL invalid' } },
    { message: 'Failed due to EXPO_PUBLIC_API_BASE' },
  ]

  const forbidden = /STRIPE|SUPABASE|CLERK|DATABASE_URL|EXPO_PUBLIC|_KEY|_SECRET/i

  for (const body of envBodies) {
    for (const status of [503, 500, 400, 402, 0, undefined]) {
      const res = friendlyApiError(status, body)
      assert.doesNotMatch(res.message, forbidden)
      // Any missing config or env var in body results in friendly unavailable copy
      assert.equal(res.kind, 'unavailable')
      assert.equal(res.message, UNAVAILABLE_COPY)
    }
  }
})

test('401 returns kind auth with sign in copy', () => {
  const r1 = friendlyApiError(401)
  assert.equal(r1.kind, 'auth')
  assert.equal(r1.message, AUTH_REQUIRED_COPY)
  assert.equal(r1.message, 'Please sign in again to continue.')

  const r2 = friendlyApiError(401, { error: 'Sign in required' })
  assert.equal(r2.kind, 'auth')
  assert.equal(r2.message, AUTH_REQUIRED_COPY)

  const r3 = friendlyApiError(401, 'Unauthorized')
  assert.equal(r3.kind, 'auth')
  assert.equal(r3.message, AUTH_REQUIRED_COPY)

  const r4 = friendlyApiError(401, { message: 'jwt expired' })
  assert.equal(r4.kind, 'auth')
  assert.equal(r4.message, AUTH_REQUIRED_COPY)

  // String status
  const r5 = friendlyApiError('401')
  assert.equal(r5.kind, 'auth')
  assert.equal(r5.message, AUTH_REQUIRED_COPY)
})

test('402 and card errors keep server message when user-facing', () => {
  const r1 = friendlyApiError(402, { message: 'Your card was declined.' })
  assert.equal(r1.kind, 'card')
  assert.equal(r1.message, 'Your card was declined.')

  const r2 = friendlyApiError(402, { error: 'Insufficient funds.' })
  assert.equal(r2.kind, 'card')
  assert.equal(r2.message, 'Insufficient funds.')

  const r3 = friendlyApiError(402, 'The card on file has expired.')
  assert.equal(r3.kind, 'card')
  assert.equal(r3.message, 'The card on file has expired.')

  const r4 = friendlyApiError(402, { failure: { message: 'Your card does not support this purchase.' } })
  assert.equal(r4.kind, 'card')
  assert.equal(r4.message, 'Your card does not support this purchase.')

  // Card error indicated by type even if status is 400
  const r5 = friendlyApiError(400, { type: 'card_error', message: 'Card security code is incorrect.' })
  assert.equal(r5.kind, 'card')
  assert.equal(r5.message, 'Card security code is incorrect.')

  // Card error indicated by code
  const r6 = friendlyApiError(400, { code: 'card_declined', message: 'Your card was declined.' })
  assert.equal(r6.kind, 'card')
  assert.equal(r6.message, 'Your card was declined.')

  // String status '402'
  const r7 = friendlyApiError('402', { message: 'Your card was declined.' })
  assert.equal(r7.kind, 'card')
  assert.equal(r7.message, 'Your card was declined.')
})

test('402 with non user-facing message or empty body falls back to generic message', () => {
  const r1 = friendlyApiError(402, { error: 'Internal Server Error' })
  assert.equal(r1.kind, 'card')
  assert.equal(r1.message, GENERIC_ERROR_COPY)
  assert.equal(r1.message, 'Something went wrong. Please try again.')

  const r2 = friendlyApiError(402, { message: 'TypeError: cannot read property of null' })
  assert.equal(r2.kind, 'card')
  assert.equal(r2.message, GENERIC_ERROR_COPY)

  const r3 = friendlyApiError(402)
  assert.equal(r3.kind, 'card')
  assert.equal(r3.message, GENERIC_ERROR_COPY)

  const r4 = friendlyApiError(402, '')
  assert.equal(r4.kind, 'card')
  assert.equal(r4.message, GENERIC_ERROR_COPY)

  const r5 = friendlyApiError(402, { message: 'card_declined' })
  assert.equal(r5.kind, 'card')
  assert.equal(r5.message, GENERIC_ERROR_COPY)
})

test('5xx other returns kind server with generic copy', () => {
  for (const status of [500, 502, 504, 599]) {
    const res = friendlyApiError(status, { error: 'Server crashed' })
    assert.equal(res.kind, 'server')
    assert.equal(res.message, GENERIC_ERROR_COPY)
    assert.equal(res.message, 'Something went wrong. Please try again.')
  }

  const rGateway = friendlyApiError(502, 'Bad Gateway')
  assert.equal(rGateway.kind, 'server')
  assert.equal(rGateway.message, GENERIC_ERROR_COPY)

  // String status '500'
  const rStr = friendlyApiError('500', 'Internal Server Error')
  assert.equal(rStr.kind, 'server')
  assert.equal(rStr.message, GENERIC_ERROR_COPY)
})

test('network error (status 0 / undefined / null) returns kind network', () => {
  const cases = [
    [0, undefined],
    [0, 'Network request failed'],
    [undefined, undefined],
    [undefined, { message: 'Failed to fetch' }],
    [null, undefined],
    ['', undefined],
  ]

  for (const [status, body] of cases) {
    const res = friendlyApiError(status, body)
    assert.equal(res.kind, 'network')
    assert.equal(res.message, NETWORK_ERROR_COPY)
    assert.equal(res.message, 'Check your connection and try again.')
  }
})

test('handles error object passed as first argument and apiClient payload', () => {
  const rAuth = friendlyApiError({ status: 401, message: 'Sign in required' })
  assert.equal(rAuth.kind, 'auth')
  assert.equal(rAuth.message, AUTH_REQUIRED_COPY)

  const rUnavailable = friendlyApiError({ status: 503, message: 'Payments unavailable' })
  assert.equal(rUnavailable.kind, 'unavailable')
  assert.equal(rUnavailable.message, UNAVAILABLE_COPY)

  const rCard = friendlyApiError({ status: 402, message: 'Your card was declined.' })
  assert.equal(rCard.kind, 'card')
  assert.equal(rCard.message, 'Your card was declined.')

  const rNetwork = friendlyApiError(new Error('Failed to fetch'))
  assert.equal(rNetwork.kind, 'network')
  assert.equal(rNetwork.message, NETWORK_ERROR_COPY)

  // apiClient authedJson shape: Error with status and payload
  const apiErr = new Error('HTTP 503')
  apiErr.status = 503
  apiErr.payload = { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY is not configured.' }
  const rClient = friendlyApiError(apiErr)
  assert.equal(rClient.kind, 'unavailable')
  assert.equal(rClient.message, UNAVAILABLE_COPY)
})

test('isUserFacing distinguishes user-friendly messages from technical traces', () => {
  assert.equal(isUserFacing('Your card was declined.'), true)
  assert.equal(isUserFacing('Insufficient funds.'), true)
  assert.equal(isUserFacing('Please check your card details and try again.'), true)

  assert.equal(isUserFacing(''), false)
  assert.equal(isUserFacing(null), false)
  assert.equal(isUserFacing('Internal Server Error'), false)
  assert.equal(isUserFacing('HTTP 402'), false)
  assert.equal(isUserFacing('500'), false)
  assert.equal(isUserFacing('card_declined'), false)
  assert.equal(isUserFacing('TypeError: foo is not a function'), false)
  assert.equal(isUserFacing('at /app/routes.js:10:4'), false)
  assert.equal(isUserFacing('STRIPE_SECRET_KEY is not configured.'), false)
  assert.equal(isUserFacing('{"error":"bad"}'), false)
})
