import test from 'node:test'
import assert from 'node:assert/strict'
import {
  friendlyApiError,
  isUserFacing,
  UNAVAILABLE_COPY,
  AUTH_REQUIRED_COPY,
  GENERIC_ERROR_COPY,
  NETWORK_ERROR_COPY,
} from './apiErrors.js'

test('src/lib/apiErrors: 503 returns kind unavailable with friendly copy', () => {
  const err = friendlyApiError(503, { error: 'Payments unavailable' })
  assert.equal(err.kind, 'unavailable')
  assert.equal(err.message, UNAVAILABLE_COPY)
  assert.equal(err.message, 'Payments are temporarily unavailable, please try again shortly')
})

test('src/lib/apiErrors: server config / env var errors return unavailable copy without leaking', () => {
  const cases = [
    { status: 500, body: { error: 'STRIPE_SECRET_KEY is not configured.' } },
    { status: 500, body: { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' } },
    { status: 503, body: 'service role missing' },
    { status: 400, body: { message: 'Failed due to STRIPE_WEBHOOK_SECRET' } },
  ]
  for (const c of cases) {
    const res = friendlyApiError(c.status, c.body)
    assert.equal(res.kind, 'unavailable')
    assert.equal(res.message, UNAVAILABLE_COPY)
    assert.doesNotMatch(res.message, /STRIPE|SUPABASE|SECRET|KEY/i)
  }
})

test('src/lib/apiErrors: 401 returns kind auth with sign in copy', () => {
  const res = friendlyApiError(401, { error: 'Sign in required' })
  assert.equal(res.kind, 'auth')
  assert.equal(res.message, AUTH_REQUIRED_COPY)
  assert.equal(res.message, 'Please sign in again to continue.')
})

test('src/lib/apiErrors: network error returns network copy', () => {
  const res = friendlyApiError(0, null)
  assert.equal(res.kind, 'network')
  assert.equal(res.message, NETWORK_ERROR_COPY)
  assert.equal(res.message, 'Check your connection and try again.')
})

test('src/lib/apiErrors: 402 keeps user-facing message, falls back for technical message', () => {
  const clean = friendlyApiError(402, { message: 'Your card has expired.' })
  assert.equal(clean.kind, 'card')
  assert.equal(clean.message, 'Your card has expired.')

  const tech = friendlyApiError(402, { message: 'card_declined' })
  assert.equal(tech.kind, 'card')
  assert.equal(tech.message, GENERIC_ERROR_COPY)
})

test('src/lib/apiErrors: isUserFacing utility', () => {
  assert.equal(isUserFacing('Your card was declined.'), true)
  assert.equal(isUserFacing('STRIPE_SECRET_KEY not set'), false)
  assert.equal(isUserFacing('Internal Server Error'), false)
  assert.equal(isUserFacing('card_declined'), false)
})
