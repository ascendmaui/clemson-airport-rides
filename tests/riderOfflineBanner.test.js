import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  OFFLINE_BANNER_BUDGET_MS,
  OFFLINE_BANNER_DELAY_MS,
  bannerVisible,
  isOfflineSnapshot,
  offlineBannerView,
  retryableFailure,
} from '../apps/rider/lib/offlineBanner.ts'
import {
  readOffline,
  registerReconnectJob,
  reportNetwork,
  resetReconnectForTests,
} from '../apps/rider/lib/reconnectRetry.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('NetInfo snapshots: disconnected or unreachable is offline', () => {
  assert.equal(isOfflineSnapshot({ isConnected: false, isInternetReachable: true }), true)
  assert.equal(isOfflineSnapshot({ isConnected: true, isInternetReachable: false }), true)
  assert.equal(isOfflineSnapshot({ isConnected: true, isInternetReachable: null }), false)
  assert.equal(isOfflineSnapshot({ isConnected: null, isInternetReachable: null }), false)
  assert.equal(isOfflineSnapshot(null), false)
})

test('banner is on brand and due inside 2 seconds of the drop', () => {
  assert.equal(OFFLINE_BANNER_BUDGET_MS, 2000)
  assert.ok(OFFLINE_BANNER_DELAY_MS >= 0)
  assert.ok(OFFLINE_BANNER_DELAY_MS <= OFFLINE_BANNER_BUDGET_MS)
  assert.equal(bannerVisible(false, 0), false)
  assert.equal(bannerVisible(true, OFFLINE_BANNER_DELAY_MS), true)
  assert.equal(bannerVisible(true, OFFLINE_BANNER_BUDGET_MS), true)
  const view = offlineBannerView(true)
  assert.equal(view.title, 'No signal')
  assert.match(view.body, /Clemson Rides/)
  assert.doesNotMatch(view.body, /Clemson RIDES/)
  assert.equal(offlineBannerView(false), null)
})

test('a permission denial is not retried just because the network returns', () => {
  assert.equal(retryableFailure('Location permission is off.'), false)
  assert.equal(retryableFailure('Network request failed'), true)
  assert.equal(retryableFailure(''), false)
  assert.equal(retryableFailure(null), false)
})

test('registered screens run once when the link returns', async () => {
  resetReconnectForTests()
  const calls = []
  const stop = registerReconnectJob('booking-home', () => { calls.push('home') })
  reportNetwork(true)
  assert.equal(readOffline(), true)
  assert.deepEqual(calls, [])
  reportNetwork(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['home'])
  reportNetwork(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['home'])
  stop()
  reportNetwork(true)
  reportNetwork(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['home'])
  resetReconnectForTests()
})

test('root layout watches NetInfo and booking, confirm, requested, and trip offer Retry', () => {
  const layout = read('apps/rider/app/_layout.tsx')
  assert.match(layout, /<NetworkWatch \/>/)
  assert.match(layout, /<OfflineBanner \/>/)
  const watch = read('apps/rider/lib/netInfoWatch.ts')
  assert.match(watch, /@react-native-community\/netinfo/)
  assert.match(watch, /NetInfo\.addEventListener/)
  assert.match(watch, /NetInfo\.fetch\(/)
  const banner = read('apps/rider/components/OfflineBanner.tsx')
  assert.match(banner, /name="offline"/)
  assert.match(banner, /borderLeftColor: colors\.orange/)
  assert.match(banner, /shadowStyle\(colors\.shadow/)
  assert.doesNotMatch(banner, /setTimeout/)
  const screens = [
    'apps/rider/app/(tabs)/index.tsx',
    'apps/rider/app/confirm.tsx',
    'apps/rider/app/tiers.tsx',
    'apps/rider/app/pick-driver.tsx',
    'apps/rider/app/requested.tsx',
    'apps/rider/components/RiderTripEnd.tsx',
  ]
  for (const file of screens) {
    const src = read(file)
    assert.match(src, /useReconnectRetry\(/, file)
    assert.match(src, /<RetryAction/, file)
  }
})
