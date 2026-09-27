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
  googleAuthErrorMessage,
  googleAuthStatusMessage,
  isGoogleAuthEnabled,
  mapGoogleAuthError,
  resolveSocialProviders,
} from './googleAuthConfig.js'
import { googleOAuthRedirect } from './googleAuth.js'

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

test('accepts EXPO_PUBLIC_GOOGLE_CLIENT_ID as alias for web client ID', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'fake-ios-id',
    EXPO_PUBLIC_GOOGLE_CLIENT_ID: 'fake-google-id',
  }
  const res = googleAuthConfig(fakeEnv)

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
  assert.equal(res.webClientId, 'fake-google-id')
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

test('custom path option strips leading slashes in redirectUri', () => {
  const fakeEnv = {}
  const res = googleAuthConfig(fakeEnv, { scheme: 'clemsonrides', path: '/oauth/redirect' })

  assert.equal(res.redirectUri, 'clemsonrides://oauth/redirect')
})

test('googleOAuthRedirect helper normalizes schemes and callback paths', () => {
  assert.equal(googleOAuthRedirect(), 'clemsonrides-driver://auth/callback')
  assert.equal(googleOAuthRedirect('clemsonrides://'), 'clemsonrides://auth/callback')
  assert.equal(googleOAuthRedirect('custom', 'callback'), 'custom://callback')
  assert.equal(googleOAuthRedirect('custom', '/callback'), 'custom://callback')
  assert.equal(googleOAuthRedirect('', ''), 'clemsonrides-driver://auth/callback')
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

test('supports options.expected as alternative to options.required', () => {
  const fakeEnv = {
    CUSTOM_CLIENT_ID: 'custom-val',
  }
  const res = googleAuthConfig(fakeEnv, { expected: ['CUSTOM_CLIENT_ID'] })

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

test('supports platform: "ios" checking iOS and web client IDs', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
  }
  const res = googleAuthConfig(fakeEnv, { platform: 'ios' })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])
})

test('supports platform: "android" checking android and web client IDs', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'android-id',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
  }
  const res = googleAuthConfig(fakeEnv, { platform: 'android' })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, [])

  // BUG?: result defines non-enumerable iosClientId and webClientId properties,
  // but omits androidClientId even when platform: 'android' is configured.
  assert.equal(res.androidClientId, undefined)
})

test('supports mode: "any" requiring at least one client id', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-only',
  }
  const res = googleAuthConfig(fakeEnv, { mode: 'any' })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'])
})

test('supports requireAll: false matching mode: "any"', () => {
  const fakeEnv = {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-only',
  }
  const res = googleAuthConfig(fakeEnv, { requireAll: false })

  assert.equal(res.enabled, true)
  assert.deepEqual(res.missing, ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'])
})

test('// BUG?: single options argument containing only mode or requireAll is treated as env', () => {
  // BUG?: If an options bag only contains mode or requireAll (e.g. { mode: 'any' })
  // without scheme, redirectUri, required, or platform, googleAuthConfig treats the object
  // as env rather than options, ignoring mode: 'any' and reporting enabled: false.
  const res = googleAuthConfig({ mode: 'any' })
  assert.equal(res.enabled, false)
})

test('// BUG?: mixed options bag containing both platform and EXPO_PUBLIC_* keys is treated as env only', () => {
  // BUG?: If an options bag contains both options (such as platform: 'web') and EXPO_PUBLIC_* keys,
  // the '!Object.keys(envOrOptions).some(k => k.startsWith("EXPO_PUBLIC_"))' check fails,
  // causing options to be ignored and treated purely as env. Consequently, platform: 'web'
  // still requires EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.
  const mixed = {
    platform: 'web',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-123',
  }
  const res = googleAuthConfig(mixed)
  assert.equal(res.enabled, false)
  assert.deepEqual(res.missing, ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'])
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

test('googleAuthStatusMessage accepts pre-resolved config object', () => {
  assert.equal(googleAuthStatusMessage({ enabled: true }), null)
  assert.equal(
    googleAuthStatusMessage({ enabled: false }),
    'Google sign-in is coming soon',
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

test('googleAuthButtonState accepts pre-resolved config object with missing array', () => {
  const preResolved = {
    enabled: true,
    missing: [],
    redirectUri: 'clemsonrides://auth/callback',
  }
  const state = googleAuthButtonState(preResolved)
  assert.deepEqual(state, {
    enabled: true,
    disabled: false,
    hidden: false,
    message: null,
    redirectUri: 'clemsonrides://auth/callback',
  })
})

test('// BUG?: googleAuthButtonState misidentifies pre-resolved config without missing array as env object', () => {
  // BUG?: googleAuthButtonState checks `Array.isArray(configOrEnv.missing)` before treating
  // the input as pre-resolved config. If an object with `{ enabled: true }` lacks `missing`,
  // it is passed to `googleAuthConfig` as an env object, resulting in `enabled: false`.
  const state = googleAuthButtonState({ enabled: true, redirectUri: 'custom://callback' })
  assert.equal(state.enabled, false)
  assert.equal(state.disabled, true)
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

test('non-enumerable helper properties and property descriptors on config result', () => {
  const res = googleAuthConfig({
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id',
  })

  const descMessage = Object.getOwnPropertyDescriptor(res, 'message')
  assert.equal(descMessage.enumerable, false)
  assert.equal(descMessage.configurable, true)
  assert.equal(descMessage.writable, true)
  assert.equal(res.message, null)

  const descStatus = Object.getOwnPropertyDescriptor(res, 'statusMessage')
  assert.equal(descStatus.enumerable, false)
  assert.equal(res.statusMessage, null)

  const descComingSoon = Object.getOwnPropertyDescriptor(res, 'comingSoonMessage')
  assert.equal(descComingSoon.enumerable, false)
  assert.equal(res.comingSoonMessage, 'Google sign-in is coming soon')

  const descIos = Object.getOwnPropertyDescriptor(res, 'iosClientId')
  assert.equal(descIos.enumerable, false)
  assert.equal(res.iosClientId, 'ios-id')

  const descWeb = Object.getOwnPropertyDescriptor(res, 'webClientId')
  assert.equal(descWeb.enumerable, false)
  assert.equal(res.webClientId, 'web-id')
})

test('handles non-object and null env inputs gracefully', () => {
  const resNull = googleAuthConfig(null)
  assert.equal(typeof resNull.enabled, 'boolean')
  assert.ok(Array.isArray(resNull.missing))

  const resNum = googleAuthConfig(12345)
  assert.equal(typeof resNum.enabled, 'boolean')

  const resStr = googleAuthConfig('invalid-env-string')
  assert.equal(typeof resStr.enabled, 'boolean')
})

test('mapGoogleAuthError maps unconfigured error to coming soon message', () => {
  const err1 = new Error(
    'Google sign-in is not configured. Enable the Google provider in Supabase Auth and allow this app redirect.',
  )
  const mapped1 = mapGoogleAuthError(err1)
  assert.equal(mapped1.message, 'Google sign-in is coming soon')
  assert.equal(mapped1.code, 'google_auth_not_configured')

  const err2 = new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')
  const mapped2 = mapGoogleAuthError(err2)
  assert.equal(mapped2.message, 'Google sign-in is coming soon')

  const mapped3 = mapGoogleAuthError('Google sign-in is coming soon')
  assert.equal(mapped3.message, 'Google sign-in is coming soon')
  assert.equal(mapped3.code, 'google_auth_coming_soon')

  const codeErr = mapGoogleAuthError({ code: 'google_not_configured' })
  assert.equal(codeErr.message, 'Google sign-in is coming soon')
  assert.equal(codeErr.code, 'google_auth_not_configured')
})

test('mapGoogleAuthError maps Supabase unconfigured error without leaking env names', () => {
  const err = new Error(
    'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.',
  )
  const mapped = mapGoogleAuthError(err)
  assert.equal(
    mapped.message,
    'Authentication is temporarily unavailable. Please try again shortly.',
  )
  assert.equal(mapped.code, 'supabase_not_configured')
  assert.doesNotMatch(mapped.message, /EXPO_PUBLIC_SUPABASE/)

  const anonErr = mapGoogleAuthError(new Error('anon_key is missing'))
  assert.equal(anonErr.code, 'supabase_not_configured')

  const serviceErr = mapGoogleAuthError(new Error('service_role access denied'))
  assert.equal(serviceErr.code, 'supabase_not_configured')
})

test('mapGoogleAuthError maps user cancelled and access denied errors', () => {
  const err1 = new Error('Google sign-in was rejected')
  const mapped1 = mapGoogleAuthError(err1)
  assert.equal(mapped1.message, 'Google sign-in was canceled.')
  assert.equal(mapped1.code, 'user_cancelled')
  assert.equal(mapped1.cancelled, true)

  const err2 = new Error('The user denied access')
  const mapped2 = mapGoogleAuthError(err2)
  assert.equal(mapped2.message, 'Google sign-in was canceled.')
  assert.equal(mapped2.cancelled, true)

  const codeCancel = mapGoogleAuthError({ code: 'user_cancelled' })
  assert.equal(codeCancel.message, 'Google sign-in was canceled.')
  assert.equal(codeCancel.cancelled, true)

  const consentErr = mapGoogleAuthError(new Error('consent_denied'))
  assert.equal(consentErr.message, 'Google sign-in was canceled.')
  assert.equal(consentErr.cancelled, true)
})

test('mapGoogleAuthError maps redirect and missing session errors', () => {
  const err = new Error(
    'Google sign-in did not return a session. Check the Supabase redirect allow list.',
  )
  const mapped = mapGoogleAuthError(err)
  assert.equal(mapped.message, 'Could not complete Google sign-in. Please try again.')
  assert.equal(mapped.code, 'invalid_session')
  assert.doesNotMatch(mapped.message, /redirect allow list/i)

  const invErr = mapGoogleAuthError(new Error('invalid_redirect uri'))
  assert.equal(invErr.code, 'invalid_session')
})

test('mapGoogleAuthError maps rate limits, existing accounts, and expired sessions', () => {
  const rateLimitErr = mapGoogleAuthError({ message: 'rate limit exceeded', status: 429 })
  assert.equal(rateLimitErr.message, 'Too many sign-in attempts. Please wait a moment and try again.')
  assert.equal(rateLimitErr.code, 'rate_limited')
  assert.equal(rateLimitErr.status, 429)

  const overRateLimit = mapGoogleAuthError({ code: 'over_email_send_rate_limit' })
  assert.equal(overRateLimit.code, 'rate_limited')

  const accountErr = mapGoogleAuthError({ message: 'User already registered', code: 'account_exists' })
  assert.equal(
    accountErr.message,
    'You already have an account with this email. Please sign in with your email and password.',
  )
  assert.equal(accountErr.code, 'account_exists')

  const userExistsErr = mapGoogleAuthError({ code: 'user_already_exists' })
  assert.equal(userExistsErr.code, 'account_exists')

  const expiredErr = mapGoogleAuthError(new Error('invalid_grant: code expired'))
  assert.equal(expiredErr.message, 'Google sign-in session expired. Please try again.')
  assert.equal(expiredErr.code, 'session_expired')
})

test('mapGoogleAuthError maps network and technical errors', () => {
  const netErr = mapGoogleAuthError(new Error('Network request failed'))
  assert.equal(netErr.message, 'Check your internet connection and try again.')
  assert.equal(netErr.code, 'network_error')

  const fetchErr = mapGoogleAuthError(new Error('failed to fetch'))
  assert.equal(fetchErr.code, 'network_error')

  const econnErr = mapGoogleAuthError(new Error('econnrefused 127.0.0.1'))
  assert.equal(econnErr.code, 'network_error')

  const techErr = mapGoogleAuthError(new TypeError('Cannot read property foo of undefined\n at line 10'))
  assert.equal(techErr.message, 'Google sign-in failed. Please try again.')
  assert.equal(techErr.code, 'google_auth_failed')

  const syntaxMsgErr = mapGoogleAuthError(new Error('SyntaxError: Unexpected token < in JSON'))
  assert.equal(syntaxMsgErr.code, 'google_auth_failed')
  assert.equal(syntaxMsgErr.message, 'Google sign-in failed. Please try again.')

  const objErr = mapGoogleAuthError({})
  assert.equal(objErr.message, 'Google sign-in failed. Please try again.')
  assert.equal(objErr.code, 'google_auth_failed')

  assert.equal(googleAuthErrorMessage(netErr), 'Check your internet connection and try again.')
  assert.equal(googleAuthErrorMessage(null), 'Google sign-in failed. Please try again.')
})

test('mapGoogleAuthError checks error.name to mask native SyntaxError, TypeError, and runtime exceptions', () => {
  const syntaxErr = mapGoogleAuthError(new SyntaxError('Unexpected token < in JSON'))
  assert.equal(syntaxErr.code, 'google_auth_failed')
  assert.equal(syntaxErr.message, 'Google sign-in failed. Please try again.')

  const typeErr = mapGoogleAuthError(new TypeError('Cannot read property of null'))
  assert.equal(typeErr.code, 'google_auth_failed')
  assert.equal(typeErr.message, 'Google sign-in failed. Please try again.')

  const refErr = mapGoogleAuthError(new ReferenceError('variable is not defined'))
  assert.equal(refErr.code, 'google_auth_failed')
  assert.equal(refErr.message, 'Google sign-in failed. Please try again.')

  const rangeErr = mapGoogleAuthError(new RangeError('Invalid array length'))
  assert.equal(rangeErr.code, 'google_auth_failed')
  assert.equal(rangeErr.message, 'Google sign-in failed. Please try again.')
})

test('mapGoogleAuthError handles null, undefined, and empty string', () => {
  const nullErr = mapGoogleAuthError(null)
  assert.equal(nullErr.message, 'Google sign-in failed. Please try again.')
  assert.equal(nullErr.code, 'google_auth_failed')

  const undefErr = mapGoogleAuthError(undefined)
  assert.equal(undefErr.message, 'Google sign-in failed. Please try again.')
  assert.equal(undefErr.code, 'google_auth_failed')

  const emptyErr = mapGoogleAuthError('')
  assert.equal(emptyErr.message, 'Google sign-in failed. Please try again.')
  assert.equal(emptyErr.code, 'google_auth_failed')
})

test('// BUG?: mapGoogleAuthError masks error messages longer than 100 characters as generic google_auth_failed', () => {
  // BUG?: Any error with message length > 100 characters is assumed to be technical/trace
  // and is replaced by generic 'Google sign-in failed. Please try again.' with code 'google_auth_failed'.
  const longErr = mapGoogleAuthError(new Error('A'.repeat(101)))
  assert.equal(longErr.code, 'google_auth_failed')
  assert.equal(longErr.message, 'Google sign-in failed. Please try again.')
})

test('// BUG?: mapGoogleAuthError drops custom code property on plain object error', () => {
  // BUG?: When an error is passed as a plain object `{ message, code }` that does not match
  // any known error branch, mapGoogleAuthError instantiates a new Error and sets err.code = 'google_auth_error',
  // dropping the original code property.
  const customErr = mapGoogleAuthError({ message: 'Custom OAuth issue', code: 'custom_oauth_code' })
  assert.equal(customErr.code, 'google_auth_error')
  assert.equal(customErr.message, 'Custom OAuth issue')
})

test('resolveSocialProviders marks Google provider disabled with honest copy when unconfigured', () => {
  const rawProviders = [
    { id: 'apple', label: 'Apple' },
    { id: 'google', label: 'Google' },
  ]

  const disabledProviders = resolveSocialProviders(rawProviders, {})
  assert.deepEqual(disabledProviders, [
    { id: 'apple', label: 'Apple' },
    {
      id: 'google',
      label: 'Google',
      enabled: false,
      disabled: true,
      hidden: true,
      message: 'Google sign-in is coming soon',
      disabledLabel: 'Continue with Google (coming soon)',
    },
  ])

  const enabledProviders = resolveSocialProviders(rawProviders, {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-123',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-123',
  })
  assert.deepEqual(enabledProviders, [
    { id: 'apple', label: 'Apple' },
    {
      id: 'google',
      label: 'Google',
      enabled: true,
      disabled: false,
      hidden: false,
      message: null,
      disabledLabel: 'Continue with Google (coming soon)',
    },
  ])

  const hiddenProviders = resolveSocialProviders(rawProviders, {}, { hideDisabled: true })
  assert.deepEqual(hiddenProviders, [{ id: 'apple', label: 'Apple' }])
})

test('resolveSocialProviders preserves non-google providers and returns new array', () => {
  const rawProviders = [
    { id: 'apple', label: 'Apple' },
    { id: 'facebook', label: 'Facebook' },
  ]
  const resolved = resolveSocialProviders(rawProviders, {})
  assert.deepEqual(resolved, rawProviders)
  assert.notEqual(resolved, rawProviders)
})

test('// BUG?: resolveSocialProviders fails to hide disabled provider if options bag passed as 2nd argument', () => {
  // BUG?: resolveSocialProviders checks optionsOrScheme?.hideDisabled (3rd argument).
  // If a caller passes `{ hideDisabled: true }` as the 2nd argument (treating it as an options bag),
  // it is ignored and the disabled provider is not hidden.
  const rawProviders = [{ id: 'google', label: 'Google' }]
  const resolved = resolveSocialProviders(rawProviders, { hideDisabled: true })
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].disabled, true)
})

test('// BUG?: resolveSocialProviders interpolates "undefined" into disabledLabel when label is missing', () => {
  // BUG?: If a google provider object has no `label` property, disabledLabel
  // evaluates to "Continue with undefined (coming soon)".
  const rawProviders = [{ id: 'google' }]
  const resolved = resolveSocialProviders(rawProviders, {})
  assert.equal(resolved[0].disabledLabel, 'Continue with undefined (coming soon)')
})
