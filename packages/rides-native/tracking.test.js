import test from 'node:test'
import assert from 'node:assert/strict'
import { trackingIssue, startLocationPublisher } from './tracking.js'
import { etaLineFor } from './liveTrip.js'

const now = Date.parse('2026-10-04T12:00:00Z')
test('freshness follows every active phase and stops at terminal phases', () => {
  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress']) {
    assert.equal(trackingIssue(status, new Date(now - 5000).toISOString(), now), null)
    assert.match(trackingIssue(status, new Date(now - 31000).toISOString(), now), /stalled/)
    assert.match(trackingIssue(status, null, now), /Waiting/)
    assert.match(trackingIssue(status, 'invalid', now), /Waiting/)
  }
  for (const status of ['completed', 'canceled', 'cancelled_wait', 'searching']) {
    assert.equal(trackingIssue(status, null, now), null)
  }
})
test('ETA changes toward drop-off instead of repeating stored whole-route duration', () => {
  const places = { dropoffLat: 34.68, dropoffLng: -82.84, metadata: { route_duration_s: 600 } }
  const far = etaLineFor('in_progress', { lat: 34.7, lng: -82.9 }, places)
  const near = etaLineFor('in_progress', { lat: 34.681, lng: -82.841 }, places)
  assert.notEqual(far, near)
  assert.match(near, /straight line to drop-off/)
  assert.equal(etaLineFor('completed', { lat: 34.68, lng: -82.84 }, places), null)
  assert.equal(etaLineFor('accepted', { lat: 34, lng: -82 }, { pickup_lat: null, pickup_lng: null }), null)
})
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
test('failed writes are visible; automatic retry obtains a new fix and clears error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = [], fixes = [], writes = []
  let n = 0
  const stop = startLocationPublisher({
    locate: async () => ++n,
    publish: async (fix) => { writes.push(fix); if (fix === 1) throw new Error('offline') },
    onFix: (fix) => fixes.push(fix), onError: (error) => errors.push(error),
  })
  await flush()
  assert.match(errors[0], /interrupted/)
  assert.deepEqual(fixes, [])
  t.mock.timers.tick(5000); await flush()
  assert.deepEqual(writes, [1, 2])
  assert.deepEqual(fixes, [2])
  assert.equal(errors.at(-1), null)
  stop(); t.mock.timers.tick(50000); await flush()
  assert.equal(n, 2)
})
test('hung GPS times out and retry recovers; cleanup ignores late location', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolve, calls = 0
  const errors = [], writes = []
  const stop = startLocationPublisher({
    locate: () => { calls++; return new Promise((r) => { resolve = r }) },
    publish: async (fix) => writes.push(fix), onFix: () => {}, onError: (e) => errors.push(e),
  })
  t.mock.timers.tick(15000); await flush()
  assert.match(errors[0], /interrupted/)
  t.mock.timers.tick(5000); await flush()
  assert.equal(calls, 2)
  stop(); resolve(42); await flush()
  assert.deepEqual(writes, [])
})
test('hung upload reports failure and never acknowledges a late write', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolveUpload
  const fixes = [], errors = []
  const stop = startLocationPublisher({
    locate: async () => 1,
    publish: () => new Promise((resolve) => { resolveUpload = resolve }),
    onFix: (fix) => fixes.push(fix), onError: (error) => errors.push(error),
  })
  await flush()
  t.mock.timers.tick(15000); await flush()
  assert.match(errors[0], /interrupted/)
  resolveUpload(); await flush()
  assert.deepEqual(fixes, [])
  stop()
})

import { createTrackingRefresh } from './tracking.js'
test('resume supersedes a hung read and ignores its late result', async () => {
  const reads = [], data = [], errors = []
  const reader = createTrackingRefresh({
    load: () => new Promise((resolve) => reads.push(resolve)),
    onData: (value) => data.push(value), onError: (error) => errors.push(error),
  })
  const first = reader.refresh(); await flush()
  await reader.refresh(); assert.equal(reads.length, 1)
  const recovery = reader.refresh(true); await flush()
  reads[1]({ status: 'completed', route: 'new' }); await recovery
  reads[0]({ status: 'in_progress', route: 'old' }); await first
  assert.deepEqual(data, [{ status: 'completed', route: 'new' }])
  assert.deepEqual(errors, [null])
  reader.stop()
})
test('read timeout retries and cleanup rejects late results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const reads = [], data = [], errors = []
  const reader = createTrackingRefresh({
    load: () => new Promise((resolve) => reads.push(resolve)),
    onData: (value) => data.push(value), onError: (error) => errors.push(error),
  })
  const first = reader.refresh(); await flush()
  t.mock.timers.tick(15000); await first
  assert.match(errors[0].message, /timed out/)
  const second = reader.refresh(); await flush()
  reads[1]('fresh'); await second
  assert.deepEqual(data, ['fresh']); assert.equal(errors.at(-1), null)
  const third = reader.refresh(); await flush()
  reader.stop(); reads[2]('unmounted'); await third
  reads[0]('obsolete'); await flush()
  assert.deepEqual(data, ['fresh'])
  await reader.refresh(true); assert.equal(reads.length, 3)
})

import { onTrackingResume } from './tracking.js'
test('browser recovery responds to foreground and online, and removes listeners', (t) => {
  const windowTarget = new EventTarget(), documentTarget = new EventTarget()
  documentTarget.hidden = true
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowTarget })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentTarget })
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete globalThis.document
  })
  let calls = 0
  const stop = onTrackingResume(() => calls++)
  windowTarget.dispatchEvent(new Event('online')); assert.equal(calls, 0)
  documentTarget.hidden = false
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  windowTarget.dispatchEvent(new Event('online')); assert.equal(calls, 2)
  stop()
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  windowTarget.dispatchEvent(new Event('online')); assert.equal(calls, 2)
})
