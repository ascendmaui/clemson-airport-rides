import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ANDROID_MAP_UNAVAILABLE,
  googleMapStyle,
  nativeMapTilesReady,
  usableGoogleMapsKey,
} from './googleMapChrome.js'

test('dark map style is applied only for the dark scheme', () => {
  assert.equal(googleMapStyle('light'), null)
  assert.equal(googleMapStyle('auto'), null)
  const dark = googleMapStyle('dark')
  assert.ok(Array.isArray(dark))
  assert.equal(dark[0].stylers[0].color, '#0e0b14')
})

test('Android map tiles stay off until a real key is configured', () => {
  assert.equal(nativeMapTilesReady('ios', {}), true)
  assert.equal(nativeMapTilesReady('android', {}), false)
  assert.equal(nativeMapTilesReady('android', { env: { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'your_google_maps_key' } }), false)
  assert.equal(usableGoogleMapsKey({ manifestKey: 'AIza-example' }), 'AIza-example')
  assert.equal(nativeMapTilesReady('android', { manifestKey: 'AIza-example' }), true)
  assert.match(ANDROID_MAP_UNAVAILABLE, /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY/)
  assert.match(ANDROID_MAP_UNAVAILABLE, /Pickup and drop-off still work/)
})

test('Android app config injects the maps key and does not request background location', () => {
  for (const app of ['rider', 'driver']) {
    const config = readFileSync(new URL(`../../apps/${app}/app.config.js`, import.meta.url), 'utf8')
    assert.match(config, /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY/)
    assert.doesNotMatch(config, /AIza[0-9A-Za-z_-]{10}/)
  }
  const driver = JSON.parse(readFileSync(new URL('../../apps/driver/app.json', import.meta.url), 'utf8'))
  const permissions = driver.expo.android.permissions
  assert.ok(permissions.includes('ACCESS_FINE_LOCATION'))
  assert.ok(permissions.includes('ACCESS_COARSE_LOCATION'))
  assert.ok(permissions.includes('POST_NOTIFICATIONS'))
  assert.equal(permissions.includes('ACCESS_BACKGROUND_LOCATION'), false)
})
