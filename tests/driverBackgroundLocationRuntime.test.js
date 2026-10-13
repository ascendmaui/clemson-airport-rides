import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import * as logic from '../packages/rides-native/backgroundLocation.js'
import { publishDriverLocation } from '../packages/rides-native/driverDesk.js'

// Exercise the native task with OS/storage/auth doubles; no Expo installation or GPS needed.
const source = readFileSync(new URL('../apps/driver/lib/backgroundLocation.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code
const fix = (timestamp, latitude = 34.68) => ({
  timestamp, coords: { latitude, longitude: -82.84, heading: 90, speed: 12 },
})

function harness({ storage = new Map(), started = false } = {}) {
  const state = {
    status: 'accepted', session: { user: { id: 'driver-1' } }, owner: 'driver-1',
    foreground: 'granted', background: 'granted', now: 10000, started,
    starts: [], stops: [], writes: [], permissions: [], readError: null,
  }
  let task
  const client = {
    auth: { async getSession() { return { data: { session: state.session }, error: null } } },
    from(table) {
      const filters = {}
      const query = {
        select() { return query },
        eq(key, value) { filters[key] = value; return query },
        async maybeSingle() {
          return {
            data: state.status && filters.driver_id === state.owner ? { id: filters.id, status: state.status } : null,
            error: state.readError,
          }
        },
        async upsert(row) { state.writes.push({ table, row }); return { error: null } },
      }
      return query
    },
  }
  const location = {
    Accuracy: { High: 4 }, ActivityType: { AutomotiveNavigation: 1 },
    async requestForegroundPermissionsAsync() { state.permissions.push('foreground'); return { status: state.foreground } },
    async requestBackgroundPermissionsAsync() { state.permissions.push('background'); return { status: state.background } },
    async hasStartedLocationUpdatesAsync() { return state.started },
    async startLocationUpdatesAsync(name, options) { state.started = true; state.starts.push({ name, options }) },
    async stopLocationUpdatesAsync(name) { state.started = false; state.stops.push(name) },
  }
  const mocks = {
    'expo-location': location,
    'expo-task-manager': { defineTask(name, callback) { task = callback } },
    'react-native': { Platform: { OS: 'ios' } },
    'rides-native/backgroundLocation': logic,
    'rides-native/driverDesk': { publishDriverLocation },
    './storage': { authStorage: {
      async getItem(key) { return storage.get(key) ?? null },
      async setItem(key, value) { storage.set(key, value) },
      async removeItem(key) { storage.delete(key) },
    } },
    './supabase': { supabase: client },
  }
  const context = vm.createContext({
    Date: class extends Date { static now() { return state.now } },
    console: { warn() {} },
  })
  const module = { exports: {} }
  const run = new vm.Script(`(function(require, module, exports) { ${compiled}\n})`).runInContext(context)
  run((name) => { assert.ok(name in mocks, name); return mocks[name] }, module, module.exports)
  return { api: module.exports, state, storage, client, location, deliver: (locations) => task({ data: { locations }, error: null }) }
}

test('native service is idempotent and foreground/background throttle survives JS restart', async () => {
  const h = harness()
  assert.equal(await h.api.startTripBackgroundLocation('trip-1'), 'started')
  assert.equal(await h.api.startTripBackgroundLocation('trip-1'), 'started')
  assert.equal(h.state.starts.length, 1)
  assert.deepEqual(h.state.permissions, ['foreground', 'background', 'foreground', 'background'])
  const { options } = h.state.starts[0]
  assert.equal(options.accuracy, h.location.Accuracy.High)
  assert.equal(options.activityType, h.location.ActivityType.AutomotiveNavigation)
  assert.equal(options.timeInterval, 5000)
  assert.equal(options.distanceInterval, 15)
  assert.equal(options.pausesUpdatesAutomatically, false)
  assert.equal(options.showsBackgroundLocationIndicator, true)
  assert.equal(options.foregroundService.notificationTitle, 'Clemson RIDES trip in progress')
  await h.api.publishDriverLocation(h.client, 'driver-1', {
    lat: 34.68, lng: -82.84, tripId: 'trip-1', tripStatus: 'accepted',
  })
  assert.deepEqual(h.state.writes.map((write) => write.table), ['driver_status', 'trip_driver_locations'])
  h.state.now = 13999
  await h.deliver([fix(12000)])
  assert.equal(h.state.writes.length, 2)
  h.state.now = 14000
  await h.deliver([fix(12000), fix(13900, 34.7), fix(13000)])
  assert.equal(h.state.writes.length, 4)
  assert.equal(h.state.writes[2].row.lat, 34.7)
  assert.equal(h.state.writes[3].row.trip_id, 'trip-1')
  assert.equal(h.state.writes[3].row.speed, 12)
  const restarted = harness({ storage: h.storage, started: true })
  restarted.state.now = 15000
  await restarted.deliver([fix(15000)])
  assert.equal(restarted.state.writes.length, 0)
  restarted.state.now = 18000
  await restarted.deliver([fix(18000)])
  assert.equal(restarted.state.writes.length, 2)
})

test('background deliveries stop every terminal status even inside the throttle window', async () => {
  for (const status of ['completed', 'canceled', 'canceled_midride', 'cancelled_wait']) {
    const h = harness()
    await h.api.startTripBackgroundLocation('trip-1')
    h.state.status = status
    await h.deliver([fix(10000)])
    assert.equal(h.state.started, false, status)
    assert.equal(h.state.stops.length, 1, status)
    assert.equal(h.state.writes.length, 0, status)
    assert.equal(h.storage.has('driver.active-trip-location'), false, status)
  }
})

test('launch reconciliation stops missing/ended trips, missing sessions, and trips belonging to another driver', async () => {
  for (const invalidate of [
    (state) => { state.status = null },
    (state) => { state.status = 'completed' },
    (state) => { state.session = null },
    (state) => { state.owner = 'another-driver' },
  ]) {
    const h = harness()
    await h.api.startTripBackgroundLocation('trip-1')
    const restarted = harness({ storage: h.storage, started: true })
    invalidate(restarted.state)
    await restarted.api.reconcileTripBackgroundLocation()
    assert.equal(restarted.state.started, false)
    assert.equal(restarted.storage.has('driver.active-trip-location'), false)
  }
  const orphan = harness({ started: true })
  await orphan.deliver([fix(10000)])
  assert.equal(orphan.state.started, false)
})

test('permission denial returns a nonblocking status without starting a service', async () => {
  const foreground = harness()
  foreground.state.foreground = 'denied'
  assert.equal(await foreground.api.startTripBackgroundLocation('trip-1'), 'foreground-denied')
  assert.deepEqual(foreground.state.permissions, ['foreground'])
  assert.equal(foreground.state.started, false)
  const background = harness()
  background.state.background = 'denied'
  assert.equal(await background.api.startTripBackgroundLocation('trip-1'), 'background-denied')
  assert.equal(background.state.started, false)
  assert.equal(background.storage.has('driver.active-trip-location'), false)
})

test('a trip ending during permission prompts cannot leave tracking running', async () => {
  const h = harness()
  h.location.requestBackgroundPermissionsAsync = async () => {
    h.state.status = 'canceled'
    return { status: 'granted' }
  }
  assert.equal(await h.api.startTripBackgroundLocation('trip-1'), 'inactive')
  assert.equal(h.state.starts.length, 0)
  assert.equal(h.storage.has('driver.active-trip-location'), false)
})

test('temporary server failure preserves tracking for retry; stale screen stops do not stop a newer trip', async () => {
  const h = harness()
  await h.api.startTripBackgroundLocation('trip-2')
  await h.api.stopTripBackgroundLocation('trip-1')
  assert.equal(h.state.started, true)
  h.state.readError = new Error('Offline')
  await assert.rejects(h.api.reconcileTripBackgroundLocation(), /Offline/)
  await h.deliver([fix(10000)])
  assert.equal(h.state.started, true)
  assert.equal(h.state.writes.length, 0)
  h.state.readError = null
  h.state.session = null
  await h.deliver([fix(15000)])
  assert.equal(h.state.started, false)
})
