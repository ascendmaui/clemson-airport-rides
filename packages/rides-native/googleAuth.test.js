import assert from 'node:assert/strict'
import test from 'node:test'
import { googleOAuthRedirect } from './googleAuth.js'

test('driver Google sign-in returns to the driver app', () => {
  assert.equal(googleOAuthRedirect(), 'clemsonrides-driver://auth/callback')
  assert.equal(googleOAuthRedirect('clemsonrides-driver'), 'clemsonrides-driver://auth/callback')
})

test('rider Google sign-in returns to the rider app', () => {
  assert.equal(googleOAuthRedirect('clemsonrides'), 'clemsonrides://auth/callback')
})
