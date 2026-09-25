import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRIVER_SOCIAL_PROVIDERS,
  RIDER_SOCIAL_PROVIDERS,
  appleFullName,
  isNativeProviderUnavailable,
  socialErrorMessage,
  splitPersonName,
} from './socialAuth.js'

test('rider and driver social providers are Apple and Google', () => {
  assert.deepEqual(
    RIDER_SOCIAL_PROVIDERS.map((provider) => provider.id),
    ['apple', 'google'],
  )
  assert.deepEqual(
    DRIVER_SOCIAL_PROVIDERS.map((provider) => provider.id),
    ['apple', 'google'],
  )
})

test('native provider availability detection', () => {
  assert.equal(
    isNativeProviderUnavailable(new Error('Apple sign-in is not available on this device')),
    true,
  )
  assert.equal(
    isNativeProviderUnavailable(new Error('expo-apple-authentication is required')),
    true,
  )
  assert.equal(isNativeProviderUnavailable(new Error('form_password_incorrect')), false)
})

test('social error message extraction', () => {
  assert.equal(socialErrorMessage(new Error('Popup blocked')), 'Popup blocked')
  assert.equal(socialErrorMessage({ message: 'User cancelled' }), 'User cancelled')
  assert.equal(socialErrorMessage(null), 'Social sign-in failed')
})

test('name splitting and apple full name formatting', () => {
  assert.deepEqual(splitPersonName('Ada Lovelace'), { firstName: 'Ada', lastName: 'Lovelace' })
  assert.deepEqual(splitPersonName('SingleName'), { firstName: 'SingleName', lastName: 'SingleName' })
  assert.equal(splitPersonName(''), null)

  assert.equal(
    appleFullName({ givenName: 'Grace', middleName: 'Brewster', familyName: 'Hopper' }),
    'Grace Brewster Hopper',
  )
  assert.equal(
    appleFullName({ givenName: 'Alan', familyName: 'Turing' }),
    'Alan Turing',
  )
  assert.equal(appleFullName('Katherine Johnson'), 'Katherine Johnson')
  assert.equal(appleFullName(null), null)
})
