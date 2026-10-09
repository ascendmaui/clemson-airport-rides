import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolveDemoBusyRoster } from '../shared/demoBusyRoster.js'
import { createAppConfigLoader, readWebDemoBusyRosterOverride } from '../shared/demoBusyRosterClient.js'
import { busyRosterFor, isBusyRosterId } from '../packages/rides-native/busyRoster.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import { resolveDriverPortrait } from '../shared/driverPortrait.js'
import { canFavoriteDriver, requestDriverTrip as clientRequest } from '../packages/rides-native/drivers.js'
import driverRouter from '../api/driver.js'
import handleAppConfig, { serverDemoBusyRoster } from '../server/endpoints/appConfig.js'
import requestDriverTrip from '../server/endpoints/requestDriverTrip.js'
import { listAssignableDrivers } from '../server/autoAssign.js'

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    end(body) { this.body = JSON.parse(body) },
  }
}

test('flag defaults off and uses first defined flag, including explicit false', () => {
  assert.equal(resolveDemoBusyRoster(), false)
  assert.equal(resolveDemoBusyRoster({ isDev: false }), false)
  assert.equal(resolveDemoBusyRoster({ isDev: true }), true)
  for (const [key, lower] of [
    ['override', { buildFlag: true, serverFlag: true, isDev: true }],
    ['buildFlag', { serverFlag: true, isDev: true }],
    ['serverFlag', { isDev: true }],
  ]) {
    for (const off of [false, '0', 'false']) assert.equal(resolveDemoBusyRoster({ ...lower, [key]: off }), false)
    for (const on of [true, '1', 'true']) assert.equal(resolveDemoBusyRoster({ ...lower, [key]: on }), true)
  }
  assert.equal(resolveDemoBusyRoster({ override: undefined, buildFlag: '', serverFlag: false, isDev: true }), false)
  assert.equal(resolveDemoBusyRoster({ override: null, buildFlag: 'invalid' }), false)
})

test('web query and hash overrides persist, clear removes, blocked storage still permits URL', () => {
  const values = new Map()
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) }
  assert.equal(readWebDemoBusyRosterOverride({ search: '?demoBusyRoster=1' }, storage), true)
  assert.equal(values.get('crDemoBusyRoster'), '1')
  assert.equal(readWebDemoBusyRosterOverride({}, storage), true)
  assert.equal(readWebDemoBusyRosterOverride({ hash: '#pick-driver?demoBusyRoster=0' }, storage), false)
  assert.equal(readWebDemoBusyRosterOverride({ search: '?demoBusyRoster=1', hash: '#demoBusyRoster=0' }, storage), true)
  assert.equal(readWebDemoBusyRosterOverride({ hash: '#demoBusyRoster=clear' }, storage), undefined)
  assert.equal(values.has('crDemoBusyRoster'), false)
  const blocked = { setItem() { throw Error('blocked') }, getItem() { throw Error('blocked') }, removeItem() { throw Error('blocked') } }
  assert.equal(readWebDemoBusyRosterOverride({ search: '?demoBusyRoster=1' }, blocked), true)
  assert.equal(readWebDemoBusyRosterOverride({}, blocked), undefined)
  assert.equal(readWebDemoBusyRosterOverride({ search: '?demoBusyRoster=clear' }, blocked), undefined)
})

test('config loader fetches once per session and treats failures or malformed data as undefined', async () => {
  for (const fetcher of [
    async () => { throw Error('offline') },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw Error('bad json') } }),
    async () => ({ ok: true, json: async () => ({ demoBusyRoster: 'true' }) }),
    async () => ({ ok: true, json: async () => ({ demoBusyRoster: false }) }),
    async () => ({ ok: true, json: async () => ({ demoBusyRoster: true }) }),
  ]) {
    const load = createAppConfigLoader()
    let calls = 0
    const counted = (...args) => { calls++; return fetcher(...args) }
    const [one, two] = await Promise.all([load('/config', counted), load('/config', counted)])
    assert.equal(calls, 1)
    assert.equal(one, two)
    assert.ok(one === undefined || typeof one === 'boolean')
    await load('/config', counted)
    assert.equal(calls, 1)
  }
})

test('unauthenticated app-config router defaults prod off, staging/local on, with env overrides both ways', async () => {
  for (const [host, env, expected] of [
    ['clemsonrides.com', {}, false],
    ['clemson-staging.example.com', {}, true],
    ['localhost:5173', {}, true],
    ['127.0.0.1:3000', {}, true],
    ['clemsonrides.com', { ALLOW_STAGING_DRY_RUN: '1' }, true],
    ['clemsonrides.com', { DEMO_BUSY_ROSTER: '1' }, true],
    ['clemson-staging.example.com', { DEMO_BUSY_ROSTER: '0' }, false],
    ['localhost', { DEMO_BUSY_ROSTER: '0', ALLOW_STAGING_DRY_RUN: '1' }, false],
  ]) {
    const res = response()
    await driverRouter({ method: 'GET', url: '/api/driver?action=app-config', headers: { host } }, res, { env })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { demoBusyRoster: expected })
    assert.equal(res.headers['Cache-Control'], 'private, max-age=30')
  }
  assert.equal(serverDemoBusyRoster(null, {}), false)
  assert.equal(serverDemoBusyRoster({}, new Proxy({}, { get() { throw Error('failure') } })), false)
  assert.doesNotThrow(() => handleAppConfig({}, { setHeader() { throw Error('disconnected') } }))
})

test('busy roster has stable seeded identities, ordinary cars, initials only, and twelve on trips', () => {
  assert.deepEqual(busyRosterFor({ enabled: false }), [])
  assert.deepEqual(busyRosterFor(), [])
  const roster = busyRosterFor({ enabled: true, now: 1200000 })
  assert.ok(roster.length >= 18 && roster.length <= 24)
  assert.equal(new Set(roster.map((d) => d.id)).size, roster.length)
  assert.deepEqual(roster, busyRosterFor({ enabled: true, now: 1200001 }))
  for (const driver of roster) {
    assert.match(driver.id, /^sim-busy-/)
    assert.equal(isBusyRosterId(driver.id), true)
    assert.equal(isSimulatedDriverId(driver.id), true)
    assert.match(driver.name, /^[A-Za-z]+ [A-Z]\.$/)
    assert.match(driver.rating, /^\d\.\d$/)
    assert.ok(Number(driver.rating) >= 4.6 && Number(driver.rating) <= 5)
    assert.ok(driver.tripCount >= 40 && driver.tripCount <= 1900)
    assert.equal(driver.online, false)
    assert.equal(driver.bookable, false)
    assert.ok(['On a trip', 'Unavailable'].includes(driver.statusLabel))
    const portrait = resolveDriverPortrait(driver)
    assert.equal(portrait.kind, 'initials')
    assert.equal(portrait.url, null)
    assert.doesNotMatch(JSON.stringify(driver), new RegExp(['https?:', 'demo-drivers', 'te' + 'sla', 'model' + ' 3', 'robo' + 'taxi', 'autonomous'].join('|'), 'i'))
  }
  const later = busyRosterFor({ enabled: true, now: 1800000 })
  assert.deepEqual(roster.map(({ status, statusLabel, ...identity }) => identity), later.map(({ status, statusLabel, ...identity }) => identity))
  assert.equal(roster.filter((d) => d.status === 'on_trip').length, 12)
  assert.equal(isBusyRosterId('real-driver'), false)
  assert.equal(isBusyRosterId(null), false)
})

test('sim-busy request is rejected server-side before DB/payment work and client-side before any API', async () => {
  const res = response()
  const sb = { from() { assert.fail('must not query DB') } }
  await requestDriverTrip({ method: 'POST', headers: {}, body: { driverId: 'sim-busy-1' } }, res, { sb, user: { id: 'rider' } })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'ride_option_unavailable')
  assert.equal(canFavoriteDriver('sim-busy-1'), false)
  await assert.rejects(() => clientRequest(sb, { riderId: 'rider', driverId: 'sim-busy-1' }), /cannot be requested/)
})

test('listAssignableDrivers excludes busy ids even with online presence and preserves real drivers', async () => {
  const real = 'real-driver'
  const simIds = busyRosterFor({ enabled: true }).map((d) => d.id)
  const sb = {
    from(table) {
      return { select() { return {
        eq() { assert.equal(table, 'driver_status'); return { data: [...simIds, real].map((driver_id) => ({ driver_id, online: true })) } },
        in(_column, ids) {
          assert.deepEqual(ids, [real])
          if (table === 'driver_applications') return { data: [{ profile_id: real, onboarding_status: 'approved' }] }
          assert.equal(table, 'profiles')
          return { data: [{ id: real, email: 'driver@example.com' }] }
        },
      } } }
    },
  }
  const result = await listAssignableDrivers(sb)
  assert.equal(result.error, null)
  assert.deepEqual(result.drivers.map((d) => d.id), [real])
})

test('both picker sources render busy cards separately without controls or participation in booking', () => {
  for (const file of ['src/screens/PickDriver.jsx', 'apps/rider/app/pick-driver.tsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    const block = source.match(/\{\/\* Busy roster:[\s\S]*?\{\/\* End busy roster\. \*\/\}/)?.[0]
    assert.ok(block, file)
    assert.match(block, /busy\.map/)
    assert.match(block, /BUSY NOW/)
    assert.match(block, /aria-disabled/)
    assert.match(block, /resolveDriverPortrait/)
    assert.match(block, /opacity: 0\.55/)
    assert.doesNotMatch(block, /onClick|onPress|onKeyDown|tabIndex|role=|accessibilityRole|Pressable|Save|toggleFavorite|requestDriverTrip|setSelected|anyOnline/)
    const rest = source.replace(block, '').replace('const busy = busyRosterFor({ enabled: demoBusyRoster })', '')
    assert.doesNotMatch(rest, /\bbusy\b/)
    assert.match(rest, /const anyOnline = drivers\.some/)
    assert.match(rest, /groupDriversForPicker\(/)
    assert.doesNotMatch(rest, /setDrivers\([^\n]*(busy|busyRoster)/)
  }
})
