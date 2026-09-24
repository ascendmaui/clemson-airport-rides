import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RIDER_SOCIAL_PROVIDERS,
  clerkErrorMessage,
  clerkSessionOutcome,
  isNativeProviderUnavailable,
  socialStrategy,
  splitPersonName,
} from './socialAuth.js'

test('rider social paths are Apple, Google, and Facebook', () => {
  assert.deepEqual(
    RIDER_SOCIAL_PROVIDERS.map((provider) => provider.strategy),
    ['oauth_apple', 'oauth_google', 'oauth_facebook'],
  )
  assert.equal(socialStrategy('facebook'), 'oauth_facebook')
})

test('cancelled browser and native social attempts are not errors', () => {
  assert.equal(clerkSessionOutcome({
    createdSessionId: null,
    authSessionResult: { type: 'cancel' },
  }).kind, 'cancelled')
  assert.equal(clerkSessionOutcome({ createdSessionId: null }).kind, 'cancelled')
  assert.equal(clerkSessionOutcome({
    createdSessionId: 'sess_1',
    authSessionResult: { type: 'success' },
  }).kind, 'session')
})

test('native hook stubs fall back to browser SSO', () => {
  assert.equal(
    isNativeProviderUnavailable(new Error('Native Google Authentication is only available on iOS and Android. For web and other platforms, please use the OAuth-based flow with useSSO and strategy: "oauth_google".')),
    true,
  )
  assert.equal(isNativeProviderUnavailable(new Error('form_password_incorrect')), false)
})

test('clerk API errors prefer the long message', () => {
  assert.equal(clerkErrorMessage({ errors: [{ message: 'short', longMessage: 'Use a verified email' }] }), 'Use a verified email')
  assert.deepEqual(splitPersonName('Ada Lovelace'), { firstName: 'Ada', lastName: 'Lovelace' })
})
