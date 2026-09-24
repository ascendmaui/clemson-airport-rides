import assert from 'node:assert/strict'
import test from 'node:test'
import { isStaleSessionError, isTransientNetworkError } from './staleSession.js'

test('detects Clerk session_exists in API error shape', () => {
  assert.equal(isStaleSessionError({ errors: [{ code: 'session_exists', message: "You're already signed in." }] }), true)
})

test('detects session_exists by code or message', () => {
  assert.equal(isStaleSessionError({ code: 'session_exists' }), true)
  assert.equal(isStaleSessionError(new Error("You're already signed in.")), true)
})

test('other Clerk errors are not stale-session errors', () => {
  assert.equal(isStaleSessionError({ errors: [{ code: 'form_identifier_not_found' }] }), false)
  assert.equal(isStaleSessionError(new Error('Social sign-in failed')), false)
  assert.equal(isStaleSessionError(null), false)
})

test('network failures are transient', () => {
  assert.equal(isTransientNetworkError(new TypeError('Network request failed')), true)
  assert.equal(isTransientNetworkError({ message: 'JWT expired' }), false)
})
