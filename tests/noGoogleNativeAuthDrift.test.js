import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { googleOAuthRedirect } from '../packages/rides-native/googleAuth.js'

// Google sign-in in both Clemson Rides apps runs on Supabase Auth through the system
// browser (signInWithOAuth + WebBrowser.openAuthSessionAsync). It needs no Google iOS
// client id or reversed-client-id URL scheme (tests/noClerk.test.js keeps the old vendor out). These checks keep the app scheme,
// the redirect the code sends, and the callback route in step.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const APPS = [
  { dir: 'apps/rider', scheme: 'clemsonrides', bundle: 'com.ascendmaui.clemsonrides.rider' },
  { dir: 'apps/driver', scheme: 'clemsonrides-driver', bundle: 'com.ascendmaui.clemsonrides.driver' },
]

for (const app of APPS) {
  test(`${app.dir}: app scheme matches the Google redirect`, () => {
    const expo = JSON.parse(read(`${app.dir}/app.json`)).expo
    assert.equal(expo.scheme, app.scheme)
    assert.equal(expo.ios.bundleIdentifier, app.bundle)
    assert.equal(expo.android.package, app.bundle)
    assert.ok(expo.plugins.includes('expo-web-browser'), 'expo-web-browser plugin')
    const social = read(`${app.dir}/lib/socialSignIn.ts`)
    assert.match(social, new RegExp(`useSocialSignIn\\(scheme = '${app.scheme}'\\)`))
    assert.match(social, /openAuthSessionAsync\(url, redirect\)/)
    assert.equal(googleOAuthRedirect(app.scheme), `${app.scheme}://auth/callback`)
  })

  test(`${app.dir}: auth/callback finishes warm deep links too`, () => {
    const source = read(`${app.dir}/app/auth/callback.tsx`)
    assert.match(source, /Linking\.useURL\(\)/)
    assert.match(source, /completeGoogleSession/)
  })

}
