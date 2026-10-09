import assert from 'node:assert/strict'
import test from 'node:test'
import {
  googleOAuthRedirectTo,
  locationAfterAuthCallback,
  needsManualCodeExchange,
  needsManualTokenSession,
  parseWebAuthCallback,
  stashAuthNext,
  takeAuthCallbackError,
  takeAuthNext,
  rememberAuthCallbackError,
} from './googleWebAuth.js'

const ORIGIN = 'https://clemsonrides.com'

test('googleOAuthRedirectTo uses the site root on the current origin', () => {
  assert.equal(googleOAuthRedirectTo(ORIGIN), `${ORIGIN}/`)
  assert.equal(googleOAuthRedirectTo(`${ORIGIN}/`), `${ORIGIN}/`)
  assert.equal(googleOAuthRedirectTo(''), '/')
})

test('parseWebAuthCallback reads a PKCE code in the query beside #/home', () => {
  const callback = parseWebAuthCallback(`${ORIGIN}/?code=pkce_home#/home`)
  assert.equal(callback.code, 'pkce_home')
  assert.equal(callback.codeInQuery, true)
  assert.equal(needsManualCodeExchange(callback), false)
  assert.equal(locationAfterAuthCallback(`${ORIGIN}/?code=pkce_home#/home`), '/#/home')
  assert.equal(locationAfterAuthCallback(`${ORIGIN}/?code=pkce_root`), '/#/home')
})

test('parseWebAuthCallback exchanges a code that the hash router hid', () => {
  const href = `${ORIGIN}/#/home?code=hash_code`
  const callback = parseWebAuthCallback(href)
  assert.equal(callback.code, 'hash_code')
  assert.equal(callback.codeInQuery, false)
  assert.equal(needsManualCodeExchange(callback), true)
  assert.equal(locationAfterAuthCallback(href), '/#/home')
})

test('parseWebAuthCallback leaves standard implicit hash tokens to the Supabase client', () => {
  const href = `${ORIGIN}/#access_token=at_1&refresh_token=rt_1&type=signup`
  const callback = parseWebAuthCallback(href)
  assert.equal(callback.accessToken, 'at_1')
  assert.equal(callback.refreshToken, 'rt_1')
  assert.equal(callback.tokensInStandardHash, true)
  assert.equal(needsManualTokenSession(callback), false)
  assert.equal(locationAfterAuthCallback(href, 'home'), '/#/home')
})

test('parseWebAuthCallback sets a session for implicit tokens nested in a hash route', () => {
  const href = `${ORIGIN}/#/auth/callback?access_token=at_2&refresh_token=rt_2`
  const callback = parseWebAuthCallback(href)
  assert.equal(needsManualTokenSession(callback), true)
  assert.equal(locationAfterAuthCallback(href), '/#/home')
})

test('parseWebAuthCallback surfaces provider errors and returns to sign-in', () => {
  const href = `${ORIGIN}/?error=access_denied&error_description=User+denied+access#/home`
  const callback = parseWebAuthCallback(href)
  assert.equal(callback.error, 'User denied access')
  assert.equal(needsManualCodeExchange(callback), false)
  assert.equal(
    locationAfterAuthCallback(href, 'sign-in', { forceHash: true }),
    '/#/sign-in',
  )
})

test('locationAfterAuthCallback strips a hash code and keeps the app route', () => {
  const href = `${ORIGIN}/#/confirm?dest=GSP&code=used_code`
  assert.equal(locationAfterAuthCallback(href), '/#/confirm?dest=GSP')
})

test('parseWebAuthCallback ignores ordinary app URLs', () => {
  assert.equal(parseWebAuthCallback(`${ORIGIN}/#/sign-in?next=confirm`), null)
  assert.equal(locationAfterAuthCallback(`${ORIGIN}/#/home`), null)
})

test('auth next and callback error round-trip through storage', () => {
  const storage = new Map()
  const memory = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
  stashAuthNext(memory, { next: 'confirm', dest: 'GSP Airport' })
  assert.deepEqual(takeAuthNext(memory), { next: 'confirm', dest: 'GSP Airport' })
  assert.equal(takeAuthNext(memory), null)
  rememberAuthCallbackError(memory, 'Google sign-in was rejected')
  assert.equal(takeAuthCallbackError(memory), 'Google sign-in was rejected')
  assert.equal(takeAuthCallbackError(memory), '')
})
