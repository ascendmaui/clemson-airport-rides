import assert from 'node:assert/strict'
import test from 'node:test'
import { googleOAuthRedirect } from './googleAuth.js'

test('driver Google sign-in returns to the driver app', () => {
  assert.equal(googleOAuthRedirect(), 'clemsonrides-driver://auth/callback')
})
