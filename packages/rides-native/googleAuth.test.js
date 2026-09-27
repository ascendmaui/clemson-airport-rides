import assert from 'node:assert/strict'
import test from 'node:test'
import * as googleAuth from './googleAuth.js'
import { completeGoogleSession, googleOAuthRedirect, startGoogleOAuth } from './googleAuth.js'

const DRIVER_CALLBACK = 'clemsonrides-driver://auth/callback'
const RIDER_CALLBACK = 'clemsonrides://auth/callback'
const PROVIDER_URL = 'https://accounts.google.com/o/oauth2/auth?client=fake'
const MISSING_SUPABASE = 'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.'
const MISSING_PROVIDER = 'Google sign-in is not configured. Enable the Google provider in Supabase Auth and allow this app redirect.'
const MISSING_SESSION = 'Google sign-in did not return a session. Check the Supabase redirect allow list.'

function fakeSupabase(methods = {}) {
  const calls = []
  const client = {
    auth: {
      async signInWithOAuth(args) {
        calls.push({ method: 'signInWithOAuth', args })
        if (methods.signInWithOAuth) return methods.signInWithOAuth(args)
        return { data: { url: PROVIDER_URL }, error: null }
      },
      async exchangeCodeForSession(code) {
        calls.push({ method: 'exchangeCodeForSession', code })
        if (methods.exchangeCodeForSession) return methods.exchangeCodeForSession(code)
        return { data: { session: { user: { id: 'user-from-code' } }, user: { id: 'user-from-code' } }, error: null }
      },
      async setSession(tokens) {
        calls.push({ method: 'setSession', tokens })
        if (methods.setSession) return methods.setSession(tokens)
        return {
          data: { session: { access_token: tokens.access_token }, user: { id: 'user-from-session' } },
          error: null,
        }
      },
    },
  }
  return { client, calls }
}

test('googleAuth exports only the redirect, start, and complete helpers', () => {
  assert.deepEqual(Object.keys(googleAuth).sort(), [
    'completeGoogleSession',
    'googleOAuthRedirect',
    'startGoogleOAuth',
  ])
  assert.equal(googleAuth.googleOAuthRedirect, googleOAuthRedirect)
  assert.equal(googleAuth.startGoogleOAuth, startGoogleOAuth)
  assert.equal(googleAuth.completeGoogleSession, completeGoogleSession)
})

test('driver Google sign-in returns to the driver app', () => {
  assert.equal(googleOAuthRedirect(), DRIVER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides-driver'), DRIVER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides-driver', 'auth/callback'), DRIVER_CALLBACK)
})

test('rider Google sign-in returns to the rider app', () => {
  assert.equal(googleOAuthRedirect('clemsonrides'), RIDER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides', '/auth/callback'), RIDER_CALLBACK)
})

test('googleOAuthRedirect falls back when the scheme or path is empty', () => {
  assert.equal(googleOAuthRedirect(''), DRIVER_CALLBACK)
  assert.equal(googleOAuthRedirect(null), DRIVER_CALLBACK)
  assert.equal(googleOAuthRedirect(undefined, ''), DRIVER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides', ''), RIDER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides', null), RIDER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides://'), RIDER_CALLBACK)
  assert.equal(googleOAuthRedirect('clemsonrides', 'reset-password'), 'clemsonrides://reset-password')
})

test('googleOAuthRedirect keeps a dirty scheme or path', () => {
  // BUG?: feeding a finished redirect back in strips only the first "://" and glues the old path onto the scheme.
  assert.equal(
    googleOAuthRedirect('clemsonrides://auth/callback'),
    'clemsonridesauth/callback://auth/callback',
  )
  assert.equal(googleOAuthRedirect(googleOAuthRedirect('clemsonrides')), 'clemsonridesauth/callback://auth/callback')

  // BUG?: scheme and path are not trimmed, so padding survives in the allow-list string.
  assert.equal(googleOAuthRedirect(' clemsonrides '), ' clemsonrides ://auth/callback')
  assert.equal(googleOAuthRedirect('clemsonrides', ' auth/callback '), 'clemsonrides:// auth/callback ')

  // BUG?: only one leading slash is removed. A path of "/" is truthy, so the default callback path is not used.
  assert.equal(googleOAuthRedirect('clemsonrides', '//auth/callback'), 'clemsonrides:///auth/callback')
  assert.equal(googleOAuthRedirect('clemsonrides', '/'), 'clemsonrides://')

  // BUG?: a trailing colon is not part of "://", so the cleaner leaves it and the URL contains ":://".
  assert.equal(googleOAuthRedirect('clemsonrides:'), 'clemsonrides:://auth/callback')

  // BUG?: a scheme that is only "://" strips to empty, a second "://" is left in place, and non-strings are coerced with String().
  assert.equal(googleOAuthRedirect('://'), '://auth/callback')
  assert.equal(googleOAuthRedirect('foo://bar://baz'), 'foobar://baz://auth/callback')
  assert.equal(googleOAuthRedirect(true), 'true://auth/callback')
})

test('startGoogleOAuth asks Supabase for a Google URL and skips the browser redirect', async () => {
  const { client, calls } = fakeSupabase()
  const url = await startGoogleOAuth(client, RIDER_CALLBACK)
  assert.equal(url, PROVIDER_URL)
  assert.deepEqual(calls, [{
    method: 'signInWithOAuth',
    args: {
      provider: 'google',
      options: {
        redirectTo: RIDER_CALLBACK,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    },
  }])
})

test('startGoogleOAuth rejects a missing client or a missing provider URL', async () => {
  for (const supabase of [null, undefined, false, '']) {
    await assert.rejects(() => startGoogleOAuth(supabase, RIDER_CALLBACK), { message: MISSING_SUPABASE })
  }
  for (const data of [null, {}, { url: '' }, { url: null }, { url: '   ' }, { url: '\n\t' }]) {
    const { client } = fakeSupabase({
      signInWithOAuth() {
        return { data, error: null }
      },
    })
    await assert.rejects(() => startGoogleOAuth(client, RIDER_CALLBACK), { message: MISSING_PROVIDER })
  }
})

test('startGoogleOAuth surfaces a provider error and prefers it over a URL', async () => {
  const providerError = new Error('provider disabled')
  const { client } = fakeSupabase({
    signInWithOAuth() {
      return { data: { url: PROVIDER_URL }, error: providerError }
    },
  })
  await assert.rejects(() => startGoogleOAuth(client, RIDER_CALLBACK), (err) => {
    assert.equal(err, providerError)
    return true
  })

  const { client: plain } = fakeSupabase({
    signInWithOAuth() {
      return { data: null, error: { message: 'Google provider is disabled' } }
    },
  })
  await assert.rejects(() => startGoogleOAuth(plain, DRIVER_CALLBACK), { message: 'Google provider is disabled' })
})

test('startGoogleOAuth rewrites Google failures with email and password copy', async () => {
  const { client: rateLimited } = fakeSupabase({
    signInWithOAuth() {
      return { data: null, error: { status: 429, message: 'Request rate limit reached' } }
    },
  })
  // BUG?: an OAuth rate limit is mapped to the signup-email cooldown message.
  await assert.rejects(() => startGoogleOAuth(rateLimited, RIDER_CALLBACK), (err) => {
    assert.match(err.message, /Too many signup emails/)
    assert.equal(err.code, 'over_email_send_rate_limit')
    assert.equal(err.status, 429)
    assert.equal(err.retryAfterSec, 60)
    return true
  })

  const { client: badPassword } = fakeSupabase({
    signInWithOAuth() {
      return { data: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }
    },
  })
  // BUG?: a Google failure that looks like invalid_credentials tells the rider the password does not match.
  await assert.rejects(() => startGoogleOAuth(badPassword, RIDER_CALLBACK), (err) => {
    assert.match(err.message, /do not match/)
    assert.match(err.message, /continue with Google/)
    assert.equal(err.code, 'invalid_credentials')
    assert.equal(err.status, 400)
    return true
  })

  const { client: exists } = fakeSupabase({
    signInWithOAuth() {
      return { data: null, error: { message: 'User already registered', code: 'user_already_exists', status: 422 } }
    },
  })
  // BUG?: an existing-account OAuth error tells the rider to reset a password.
  await assert.rejects(() => startGoogleOAuth(exists, RIDER_CALLBACK), (err) => {
    assert.match(err.message, /reset your password/i)
    assert.equal(err.code, 'account_exists')
    assert.equal(err.status, 422)
    return true
  })

  const { client: stringError } = fakeSupabase({
    signInWithOAuth() {
      return { data: { url: PROVIDER_URL }, error: 'provider disabled' }
    },
  })
  // BUG?: a string error has no message property, so mapAuthError replaces it with "Auth failed".
  await assert.rejects(() => startGoogleOAuth(stringError, RIDER_CALLBACK), { message: 'Auth failed' })
})

test('startGoogleOAuth forwards a blank redirect and trims a padded provider URL', async () => {
  const { client, calls } = fakeSupabase()
  // BUG?: a missing redirectTo is forwarded as undefined instead of googleOAuthRedirect().
  await startGoogleOAuth(client)
  assert.equal(calls[0].args.options.redirectTo, undefined)
  // BUG?: a blank redirectTo is forwarded unchanged, so Supabase never receives the app callback.
  await startGoogleOAuth(client, '   ')
  assert.equal(calls[1].args.options.redirectTo, '   ')

  const { client: paddedUrl } = fakeSupabase({
    signInWithOAuth() {
      return { data: { url: `  ${PROVIDER_URL}\n` }, error: null }
    },
  })
  assert.equal(await startGoogleOAuth(paddedUrl, RIDER_CALLBACK), PROVIDER_URL)
})

test('startGoogleOAuth throws TypeError when the auth client cannot be read', async () => {
  // BUG?: a truthy client with no auth object throws TypeError instead of the configuration error.
  await assert.rejects(() => startGoogleOAuth({}, RIDER_CALLBACK), (err) => {
    assert.equal(err instanceof TypeError, true)
    assert.match(err.message, /signInWithOAuth/)
    return true
  })

  const { client } = fakeSupabase({
    signInWithOAuth() {
      return null
    },
  })
  // BUG?: a null auth response is destructured and throws TypeError instead of the not-configured error.
  await assert.rejects(() => startGoogleOAuth(client, RIDER_CALLBACK), (err) => {
    assert.equal(err instanceof TypeError, true)
    assert.match(err.message, /destructure/)
    return true
  })
})

test('completeGoogleSession stores implicit-grant tokens from the hash or the query', async () => {
  const { client, calls } = fakeSupabase()
  const hashResult = await completeGoogleSession(
    client,
    'clemsonrides://auth/callback#access_token=aaa&refresh_token=bbb&type=signup',
  )
  assert.deepEqual(hashResult, { session: { access_token: 'aaa' }, user: { id: 'user-from-session' } })
  assert.deepEqual(calls[0], { method: 'setSession', tokens: { access_token: 'aaa', refresh_token: 'bbb' } })

  const queryResult = await completeGoogleSession(
    client,
    'clemsonrides-driver://auth/callback?access_token=aa%2Fbb&refresh_token=cc%2Bdd',
  )
  assert.equal(queryResult.session.access_token, 'aa/bb')
  assert.deepEqual(calls[1], { method: 'setSession', tokens: { access_token: 'aa/bb', refresh_token: 'cc+dd' } })
  assert.equal(calls.some((call) => call.method === 'exchangeCodeForSession'), false)
})

test('completeGoogleSession exchanges a PKCE code from the query or the hash', async () => {
  const { client, calls } = fakeSupabase()
  const fromQuery = await completeGoogleSession(client, 'clemsonrides://auth/callback?code=pkce-code&type=signup')
  assert.deepEqual(fromQuery, { session: { user: { id: 'user-from-code' } }, user: { id: 'user-from-code' } })
  assert.deepEqual(calls[0], { method: 'exchangeCodeForSession', code: 'pkce-code' })

  const fromHash = await completeGoogleSession(client, 'clemsonrides-driver://auth/callback#code=hash-code')
  assert.equal(fromHash.user.id, 'user-from-code')
  assert.deepEqual(calls[1], { method: 'exchangeCodeForSession', code: 'hash-code' })

  await completeGoogleSession(client, 'clemsonrides://auth/callback?code=abc%2Bdef')
  assert.equal(calls[2].code, 'abc+def')
  assert.equal(calls.some((call) => call.method === 'setSession'), false)
})

test('completeGoogleSession explains a rejected Google redirect', async () => {
  const { client } = fakeSupabase()
  for (const supabase of [null, undefined, false, '']) {
    await assert.rejects(() => completeGoogleSession(supabase, RIDER_CALLBACK), { message: MISSING_SUPABASE })
  }
  for (const callbackUrl of ['clemsonrides://auth/callback', '', null, 'clemsonrides://auth/callback#access_token=only']) {
    await assert.rejects(() => completeGoogleSession(client, callbackUrl), { message: MISSING_SESSION })
  }

  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error=access_denied&error_description=User%20denied%20the%20request'),
    { message: 'User denied the request' },
  )
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback#error=access_denied&error_description=User%20denied%20the%20request'),
    { message: 'User denied the request' },
  )
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error=access_denied'),
    { message: 'access_denied' },
  )
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback#error_description=&error=server_error'),
    { message: 'server_error' },
  )
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error_description=User+denied+access'),
    { message: 'User denied access' },
  )
})

test('completeGoogleSession maps exchange and setSession failures', async () => {
  const exchangeError = new Error('code expired')
  const { client } = fakeSupabase({
    exchangeCodeForSession() {
      return { data: null, error: exchangeError }
    },
  })
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?code=abc'),
    (err) => {
      assert.equal(err, exchangeError)
      return true
    },
  )

  const { client: sessionClient } = fakeSupabase({
    setSession() {
      return { data: null, error: { message: 'invalid claim' } }
    },
  })
  await assert.rejects(
    () => completeGoogleSession(sessionClient, 'clemsonrides://auth/callback#access_token=aaa&refresh_token=bbb'),
    { message: 'invalid claim' },
  )

  const { client: stringError } = fakeSupabase({
    setSession() {
      return { data: null, error: 'invalid claim' }
    },
  })
  // BUG?: a string error from setSession is replaced with "Auth failed".
  await assert.rejects(
    () => completeGoogleSession(stringError, 'clemsonrides://auth/callback#access_token=aaa&refresh_token=bbb'),
    { message: 'Auth failed' },
  )

  const { client: rateLimited } = fakeSupabase({
    exchangeCodeForSession() {
      return { data: null, error: { status: 429, message: 'rate limit' } }
    },
  })
  // BUG?: a PKCE exchange rate limit is mapped to the signup-email cooldown message.
  await assert.rejects(
    () => completeGoogleSession(rateLimited, 'clemsonrides://auth/callback?code=abc'),
    (err) => {
      assert.match(err.message, /Too many signup emails/)
      assert.equal(err.code, 'over_email_send_rate_limit')
      assert.equal(err.status, 429)
      return true
    },
  )
})

test('completeGoogleSession drops the provider error for several redirect shapes', async () => {
  const { client } = fakeSupabase()
  // BUG?: a fragment, even an empty one, hides error params that live in the query string.
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error=access_denied&error_description=User%20denied#'),
    { message: 'Google sign-in was rejected' },
  )
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error=access_denied&error_description=User%20denied#_'),
    { message: 'Google sign-in was rejected' },
  )
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error=access_denied#error_description=FromHash'),
    { message: 'FromHash' },
  )

  // BUG?: the error scan is unanchored, so "my_error=" counts as an OAuth rejection and the real message is lost.
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?my_error=nope'),
    { message: 'Google sign-in was rejected' },
  )

  // BUG?: a whitespace-only error_description is thrown as the message and hides the error code.
  await assert.rejects(
    () => completeGoogleSession(client, 'clemsonrides://auth/callback?error=access_denied&error_description=%20%20'),
    (err) => {
      assert.equal(err.message, '  ')
      return true
    },
  )
})

test('completeGoogleSession ignores an OAuth error when tokens or a code are also present', async () => {
  const { client, calls } = fakeSupabase()
  // BUG?: access and refresh tokens win over error and error_description, so the rejection is never thrown.
  const session = await completeGoogleSession(
    client,
    'clemsonrides://auth/callback?error=access_denied&error_description=User%20denied#access_token=aaa&refresh_token=bbb',
  )
  assert.equal(session.session.access_token, 'aaa')
  assert.deepEqual(calls[0].tokens, { access_token: 'aaa', refresh_token: 'bbb' })

  // BUG?: a PKCE code wins over an error query, so exchangeCodeForSession runs instead of throwing the description.
  const exchanged = await completeGoogleSession(
    client,
    'clemsonrides://auth/callback?error=access_denied&error_description=User%20denied&code=abc',
  )
  assert.equal(exchanged.user.id, 'user-from-code')
  assert.equal(calls[1].code, 'abc')
})

test('completeGoogleSession treats a missing session payload as success', async () => {
  const { client } = fakeSupabase({
    setSession() {
      return { data: { session: null, user: null }, error: null }
    },
  })
  // BUG?: setSession can return no session and no error, and that payload is returned as success.
  assert.deepEqual(
    await completeGoogleSession(client, 'clemsonrides://auth/callback#access_token=aaa&refresh_token=bbb'),
    { session: null, user: null },
  )

  const { client: codeClient } = fakeSupabase({
    exchangeCodeForSession() {
      return { data: null, error: null }
    },
  })
  // BUG?: exchangeCodeForSession can return null data with no error, and null is returned as success.
  assert.equal(await completeGoogleSession(codeClient, 'clemsonrides://auth/callback?code=abc'), null)
})

test('completeGoogleSession corrupts a PKCE code that contains a plus', async () => {
  const { client, calls } = fakeSupabase()
  // BUG?: URLSearchParams turns "+" into a space before exchangeCodeForSession runs.
  await completeGoogleSession(client, 'clemsonrides://auth/callback?code=abc+def/ghi')
  assert.equal(calls[0].code, 'abc def/ghi')
})

test('completeGoogleSession throws TypeError when the session methods are missing', async () => {
  // BUG?: a truthy client with no auth object throws TypeError instead of the configuration error.
  await assert.rejects(
    () => completeGoogleSession({}, 'clemsonrides://auth/callback?code=abc'),
    (err) => {
      assert.equal(err instanceof TypeError, true)
      assert.match(err.message, /exchangeCodeForSession/)
      return true
    },
  )
})
