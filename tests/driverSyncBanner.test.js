import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { showSyncBannerOn, syncBannerView } from '../apps/driver/lib/syncBanner.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('no signal with saved taps shows "N actions waiting to sync"', () => {
  assert.equal(syncBannerView({ offline: true, pending: 2 }).title, 'No signal · 2 actions waiting to sync')
  assert.equal(syncBannerView({ offline: true, pending: 1 }).title, 'No signal · 1 action waiting to sync')
  assert.match(syncBannerView({ offline: false, pending: 1 }).title, /^Syncing/)
})

test('the banner clears once the queue is empty (reconnected and sent)', () => {
  assert.equal(syncBannerView({ offline: false, pending: 0 }), null)
  assert.equal(syncBannerView({ offline: true, pending: 0 }), null)
})

test('hidden on the trip screen, which has its own signal note', () => {
  assert.equal(showSyncBannerOn('/trip'), false)
  assert.equal(showSyncBannerOn('/'), true)
  assert.equal(showSyncBannerOn('/queue'), true)
  assert.equal(showSyncBannerOn('/trip-details'), true)
})

test('mounted app-wide, reads the shared action queue, tap retries', () => {
  const layout = read('apps/driver/app/_layout.tsx')
  assert.match(layout, /<CrashBoundary scope="sync" compact>\s*<SyncBanner \/>/)
  const banner = read('apps/driver/components/SyncBanner.tsx')
  assert.match(banner, /useDriverActionQueue\(\)/)
  assert.match(banner, /driverActionQueue\(\)\?\.flush\(\)/)
  assert.match(banner, /announceForAccessibility/)
})
