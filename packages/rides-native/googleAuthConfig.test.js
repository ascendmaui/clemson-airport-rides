import assert from 'node:assert/strict'
import test from 'node:test'
import googleAuthConfigDefault, {
  EXPECTED_GOOGLE_ENV_VARS,
  GOOGLE_AUTH_COMING_SOON,
  GOOGLE_AUTH_ENV_VARS,
  GOOGLE_IOS_CLIENT_ID_KEY,
  GOOGLE_SIGN_IN_COMING_SOON,
  GOOGLE_WEB_CLIENT_ID_KEY,
  getGoogleAuthConfig,
  googleAuthButtonState,
  googleAuthConfig,
  googleAuthStatusMessage,
  isGoogleAuthEnabled,
} from './googleAuthConfig.js'

test('exports expected constants and env keys', () => {
  assert.equal(GOOGLE_IOS_CLIENT_ID_KEY, 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID')
  assert.equal(GOOGLE_WEB_CLIENT_ID_KEY, 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')
  assert.deepEqual(EXPECTED_GOOGLE_ENV_VARS, [
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  ])
  assert.equal(GOOGLE_AUTH_ENV_VARS, EXPECTED_GOOGLE_ENV_VARS)
  assert.equal(GOOGLE_SIGN_IN_COMING_SOON, 'Google sign-in is coming soon')
  assert.equal(GOOGLE_AUTH_COMING_SOON, 'Google sign-in is coming soon')
})

test('unconfigured fake env reports missing keys and disabled status', () => {
  const fakeEnv = {}
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, false)
  assert.deepEqual(res.missing, [
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  ])
  assert.equal(res.redirectUri, 'clemsonrides-driver://auth/callback')
  assert.equal(res.message, 'Google sign-in is coming soon')
  assert.equal(res.comingSoonMessage, 'Google sign-in is coming soon')
})

test('missing only web client ID reports disabled and specific missing var', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'fake-ios-client-id.apps.googleusercontent.com',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, false)
  assert.deepEqual(res.missing, ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'])
  assert.equal(res.iosClientId, 'fake-ios-client-id.apps.googleusercontent.com')
  assert.equal(res.webClientId, null)
})

test('missing only iOS client ID reports disabled and specific missing var', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'fake-web-client-id.apps.googleusercontent.com',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, false)
  assert.deepEqual(res.missing, ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'])
  assert.equal(res.iosClientId, null)
  assert.equal(res.webClientId, 'fake-web-client-id.apps.googleusercontent.com')
})

test('blank or whitespace env values are treated as missing', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '   ',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, false)
  assert.deepEqual(res.missing, [
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  ])
})

test('fully configured fake env reports enabled: true and empty missing array', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'fake-ios-client-id.apps.googleusercontent.com',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'fake-web-client-id.apps.googleusercontent.com',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
  assert.equal(res.message, null)
  assert.equal(res.statusMessage, null)
  assert.equal(res.iosClientId, 'fake-ios-client-id.apps.googleusercontent.com')
  assert.equal(res.webClientId, 'fake-web-client-id.apps.googleusercontent.com')
})

test('values with surrounding whitespace are trimmed and accepted', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '  trimmed-ios-id  ',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '  trimmed-web-id  ',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
  assert.equal(res.iosClientId, 'trimmed-ios-id')
  assert.equal(res.webClientId, 'trimmed-web-id')
})

test('accepts EXPO_PUBLIC_WEB_CLIENT_ID as alias for web client ID', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'fake-ios-id',
    EXPO_PUBLIC_WEB_CLIENT_ID: 'fake-web-id',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
  assert.equal(res.webClientId, 'fake-web-id')
})

test('rider app scheme generates rider redirectUri', () => {
  const fakeEnv = {}
  const res = googleAuthConfig(fakeEnv, { scheme: 'clemsonrides' })

  assert.equal(res.redirectUri, 'clemsonrides://auth/callback')
})

test('supports scheme passed as second string argument', () => {
  const fakeEnv = {}
  const res = googleAuthConfig(fakeEnv, 'clemsonrides')

  assert.equal(res.redirectUri, 'clemsonrides://auth/callback')
})

test('supports scheme in options bag with env property', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-123',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-123',
  }
  const res = googleAuthConfig({ env: fakeEnv, scheme: 'clemsonrides' })

  assert.equal(res.enabled, true)
  assert.equal(res.redirectUri, 'clemsonrides://auth/callback')
})

test('reads EXPO_PUBLIC_APP_SCHEME from env when no scheme option provided', () => {
  const fakeEnv = {
    EXPO_PUBLIC_APP_SCHEME: 'clemsonrides',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.redirectUri, 'clemsonrides://auth/callback')
})

test('custom redirectUri option overrides default computed redirect', () => {
  const fakeEnv = {}
  const res = googleAuthConfig(fakeEnv, { redirectUri: 'custom-scheme://oauth/callback' })

  assert.equal(res.redirectUri, 'custom-scheme://oauth/callback')
})

test('custom path option changes callback path', () => {
  const fakeEnv = {}
  const res = googleAuthConfig(fakeEnv, { scheme: 'clemsonrides', path: 'auth/google-callback' })

  assert.equal(res.redirectUri, 'clemsonrides://auth/google-callback')
})

test('getGoogleAuthConfig and default export are aliases for googleAuthConfig', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
  }

  assert.equal(getGoogleAuthConfig, googleAuthConfig)
  assert.equal(googleAuthConfigDefault, googleAuthConfig)

  const r1 = getGoogleAuthConfig(fakeEnv)
  const r2 = googleAuthConfigDefault(fakeEnv)
  assert.equal(r1.enabled, true)
  assert.equal(r2.enabled, true)
})

test('supports custom required env vars via options.required', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-only',
  }
  const res = googleAuthConfig(fakeEnv, { required: ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
})

test('supports platform: "web" checking web client id only', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
  }
  const res = googleAuthConfig(fakeEnv, { platform: 'web' })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
})

test('supports mode: "any" requiring at least one client id', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-only',
  }
  const res = googleAuthConfig(fakeEnv, { mode: 'any' })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'])
})

test('isGoogleAuthEnabled helper returns boolean', () => {
  assert.equal(isGoogleAuthEnabled({}), false)
  assert.equal(
    isGoogleAuthEnabled({
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
    }),
    true,
  )
})

test('googleAuthStatusMessage helper returns honest coming soon copy when disabled', () => {
  assert.equal(googleAuthStatusMessage({}), 'Google sign-in is coming soon')
  assert.equal(
    googleAuthStatusMessage({
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
    }),
    null,
  )
})

test('googleAuthButtonState helper provides disabled and hidden flags with message', () => {
  const disabledState = googleAuthButtonState({})
  assert.deepEqual(disabledState, {
    enabled: false,
    disabled: true,
    hidden: true,
    message: 'Google sign-in is coming soon',
    redirectUri: 'clemsonrides-driver://auth/callback',
  })

  const enabledState = googleAuthButtonState({
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
  })
  assert.deepEqual(enabledState, {
    enabled: true,
    disabled: false,
    hidden: false,
    message: null,
    redirectUri: 'clemsonrides-driver://auth/callback',
  })
})

test('enumerable keys are strictly { enabled, missing, redirectUri }', () => {
  const res = googleAuthConfig({})
  assert.deepEqual(Object.keys(res), ['enabled', 'missing', 'redirectUri'])

  const json = JSON.parse(JSON.stringify(res))
  assert.deepEqual(json, {
    enabled: false,
    missing: [
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    ],
    redirectUri: 'clemsonrides-driver://auth/callback',
  })
})
