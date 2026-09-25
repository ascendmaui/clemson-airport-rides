import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_QUIET,
  NOTIFICATION_CATEGORIES,
  fetchNotificationPrefs,
  normalizePrefs,
  quietFromPrefs,
  readLocalPrefs,
  saveNotificationPrefs,
  writeLocalPrefs,
} from './notificationPrefs.js'

const PREFS_KEY = (userId) => `clemson.notification_prefs.${userId || 'anon'}`

function memoryStorage(seed = {}) {
  const data = { ...seed }
  return {
    data,
    async getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    },
    async setItem(key, value) {
      data[key] = value
    },
  }
}

function fakeSupabase({ read, write } = {}) {
  const calls = []
  const client = {
    from(table) {
      calls.push({ op: 'from', table })
      return {
        select(columns) {
          calls.push({ op: 'select', columns })
          return {
            eq(column, value) {
              calls.push({ op: 'eq', column, value })
              return {
                async maybeSingle() {
                  calls.push({ op: 'maybeSingle' })
                  if (typeof read === 'function') return read()
                  return { data: null, error: null }
                },
              }
            },
          }
        },
        update(payload) {
          calls.push({ op: 'update', payload })
          return {
            async eq(column, value) {
              calls.push({ op: 'eq', column, value })
              if (typeof write === 'function') return write(payload)
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { client, calls }
}

function defaults() {
  return {
    ride: true,
    billing: true,
    friends: true,
    promotions: false,
    system: true,
    quiet: { dnd: false, scheduleEnabled: false, start: '22:00', end: '07:00' },
    dndNewRequestTones: false,
  }
}

test('category list and default records match the rider account screen', () => {
  assert.deepEqual(NOTIFICATION_CATEGORIES, [
    { id: 'ride', label: 'Ride updates', hint: 'Requested, accepted, en route, arrived, trip started or completed' },
    { id: 'billing', label: 'Billing & receipts', hint: 'Fare charged, payment failed, receipts' },
    { id: 'friends', label: 'Friends / carpool', hint: 'Friend joined or left, carpool booked, location shared' },
    { id: 'promotions', label: 'Promotions', hint: 'Deals, surge alerts, campus campaigns' },
    { id: 'system', label: 'System', hint: 'Account, verification, security notices' },
  ])
  assert.deepEqual(NOTIFICATION_CATEGORIES.map((category) => category.id), [
    'ride',
    'billing',
    'friends',
    'promotions',
    'system',
  ])
  assert.deepEqual(DEFAULT_QUIET, {
    dnd: false,
    scheduleEnabled: false,
    start: '22:00',
    end: '07:00',
  })
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFS, defaults())
  assert.notEqual(DEFAULT_NOTIFICATION_PREFS.quiet, DEFAULT_QUIET)
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.equal(typeof DEFAULT_NOTIFICATION_PREFS[category.id], 'boolean')
  }
})

test('quietFromPrefs fills a valid window and keeps only the quiet fields', () => {
  assert.deepEqual(quietFromPrefs({
    quiet: { dnd: true, scheduleEnabled: true, start: '21:30', end: '06:15', note: 'ignored' },
    ride: false,
  }), {
    dnd: true,
    scheduleEnabled: true,
    start: '21:30',
    end: '06:15',
  })
})

test('quietFromPrefs completes a partial window from the defaults', () => {
  assert.deepEqual(quietFromPrefs({ quiet: { end: '08:45' } }), {
    dnd: false,
    scheduleEnabled: false,
    start: '22:00',
    end: '08:45',
  })
  assert.deepEqual(quietFromPrefs({ quiet: { scheduleEnabled: false, dnd: false, start: '23:00' } }), {
    dnd: false,
    scheduleEnabled: false,
    start: '23:00',
    end: '07:00',
  })
  assert.deepEqual(quietFromPrefs({}), {
    dnd: false,
    scheduleEnabled: false,
    start: '22:00',
    end: '07:00',
  })
})

test('quietFromPrefs treats missing and non-object quiet as the default window', () => {
  const fallback = { dnd: false, scheduleEnabled: false, start: '22:00', end: '07:00' }
  for (const raw of [null, undefined, 'night', 22, true, false, 0, { quiet: null }, { quiet: '22:00' }, { quiet: 2200 }]) {
    assert.deepEqual(quietFromPrefs(raw), fallback)
  }
  // BUG?: an array is an object, so it is accepted as a quiet record instead of being rejected.
  assert.deepEqual(quietFromPrefs({ quiet: ['22:00'] }), fallback)
})

test('quietFromPrefs keeps real HH:MM clocks and drops impossible ones', () => {
  assert.deepEqual(quietFromPrefs({
    quiet: { start: '9:00', end: '07:00:00', dnd: 0, scheduleEnabled: 1 },
  }), {
    dnd: false,
    scheduleEnabled: true,
    start: '22:00',
    end: '07:00',
  })
  assert.equal(quietFromPrefs({ quiet: { start: ' 22:00', end: '07:0' } }).start, '22:00')
  assert.equal(quietFromPrefs({ quiet: { end: '07:0' } }).end, '07:00')
  assert.equal(quietFromPrefs({ quiet: { start: '00:00', end: '23:59' } }).start, '00:00')
  assert.equal(quietFromPrefs({ quiet: { start: '00:00', end: '23:59' } }).end, '23:59')

  const impossible = quietFromPrefs({ quiet: { start: '99:99', end: '24:61' } })
  assert.equal(impossible.start, '22:00')
  assert.equal(impossible.end, '07:00')
  assert.equal(quietFromPrefs({ quiet: { start: '24:00', end: '23:60' } }).start, '22:00')
  assert.equal(quietFromPrefs({ quiet: { start: '24:00', end: '23:60' } }).end, '07:00')

  // BUG?: Boolean("false") is true, so a string switch turns the quiet flag on.
  const coerced = quietFromPrefs({ quiet: { dnd: 'false', scheduleEnabled: 'no' } })
  assert.equal(coerced.dnd, true)
  assert.equal(coerced.scheduleEnabled, true)
  assert.equal(quietFromPrefs({ quiet: { dnd: '' } }).dnd, false)
})

test('normalizePrefs returns a fresh default record for empty and non-object input', () => {
  for (const raw of [null, undefined, 'prefs', 0, 1, false, true, Number.NaN]) {
    const prefs = normalizePrefs(raw)
    assert.deepEqual(prefs, defaults())
    assert.notEqual(prefs, DEFAULT_NOTIFICATION_PREFS)
    assert.notEqual(prefs.quiet, DEFAULT_NOTIFICATION_PREFS.quiet)
    assert.notEqual(prefs.quiet, DEFAULT_QUIET)
  }
  const first = normalizePrefs(null)
  first.ride = false
  first.quiet.start = '01:00'
  assert.deepEqual(normalizePrefs(undefined), defaults())
  assert.equal(DEFAULT_NOTIFICATION_PREFS.ride, true)
  assert.equal(DEFAULT_QUIET.start, '22:00')
})

test('normalizePrefs keeps a valid record and does not mutate the input', () => {
  const raw = {
    ride: true,
    billing: false,
    friends: true,
    promotions: false,
    system: false,
    quiet: { dnd: false, scheduleEnabled: true, start: '21:00', end: '06:30' },
    dndNewRequestTones: true,
  }
  const snapshot = structuredClone(raw)
  const prefs = normalizePrefs(raw)
  assert.deepEqual(raw, snapshot)
  assert.notEqual(prefs, raw)
  assert.notEqual(prefs.quiet, raw.quiet)
  assert.deepEqual(prefs, raw)
})

test('normalizePrefs fills partial records and honors legacy opt-out aliases', () => {
  assert.deepEqual(normalizePrefs({ ride: false, promotions: true }), {
    ride: false,
    promotions: true,
    billing: true,
    friends: true,
    system: true,
    quiet: { dnd: false, scheduleEnabled: false, start: '22:00', end: '07:00' },
    dndNewRequestTones: false,
  })

  const legacy = normalizePrefs({
    ride: true,
    ride_updates: false,
    friends: true,
    friends_carpool: false,
  })
  assert.equal(legacy.ride, false)
  assert.equal(legacy.friends, false)
  assert.equal(legacy.ride_updates, false)
  assert.equal(legacy.friends_carpool, false)
  assert.equal(normalizePrefs({ ride_updates: false }).ride, false)
  assert.equal(normalizePrefs({ friends_carpool: false }).friends, false)
  assert.equal(normalizePrefs({ ride: false, ride_updates: true }).ride, false)
  assert.equal(normalizePrefs({ billing: false, system: false }).billing, false)
  assert.equal(normalizePrefs({ billing: false, system: false }).system, false)
})

test('normalizePrefs coerces wrong types and keeps unknown categories', () => {
  const raw = {
    ride: 'no',
    billing: 0,
    friends: null,
    system: 'false',
    promotions: 'false',
    dndNewRequestTones: 'false',
    marketing: true,
    quiet: { start: '99:99', dnd: 'false', extra: true },
  }
  const prefs = normalizePrefs(raw)

  // BUG?: ride, billing, friends, and system stay on for every value other than boolean false.
  assert.equal(prefs.ride, true)
  assert.equal(prefs.billing, true)
  assert.equal(prefs.friends, true)
  assert.equal(prefs.system, true)

  // BUG?: Boolean("false") is true for the opt-in flags.
  assert.equal(prefs.promotions, true)
  assert.equal(prefs.dndNewRequestTones, true)
  assert.equal(normalizePrefs({ promotions: [] }).promotions, true)
  assert.equal(normalizePrefs({ promotions: 1 }).promotions, true)
  assert.equal(normalizePrefs({ promotions: 0 }).promotions, false)

  // BUG?: unknown keys are copied through and would be written back to the profile.
  assert.equal(prefs.marketing, true)
  assert.equal(prefs.quiet.extra, undefined)
  assert.equal(prefs.quiet.start, '22:00')
  assert.equal(prefs.quiet.dnd, true)
  assert.equal(raw.quiet.extra, true)
})

test('normalizePrefs accepts arrays and other non-plain objects as records', () => {
  // BUG?: typeof [] === "object", so a JSON array becomes a prefs object with index keys.
  const fromArray = normalizePrefs(['ride', false])
  assert.equal(fromArray.ride, true)
  assert.equal(fromArray.promotions, false)
  assert.equal(fromArray[0], 'ride')
  assert.equal(fromArray[1], false)
  assert.deepEqual(fromArray.quiet, defaults().quiet)

  const fromDate = normalizePrefs(new Date('2020-01-01T00:00:00.000Z'))
  assert.equal(fromDate.ride, true)
  assert.equal(fromDate.promotions, false)
  assert.deepEqual(fromDate.quiet, defaults().quiet)
})

test('readLocalPrefs normalizes stored JSON and isolates each user', async () => {
  const storage = memoryStorage()
  await writeLocalPrefs(storage, 'rider-1', {
    ride: false,
    promotions: true,
    quiet: { dnd: true, start: '23:10' },
    marketing: true,
  })
  await writeLocalPrefs(storage, 'rider-2', { billing: false })

  const first = await readLocalPrefs(storage, 'rider-1')
  const second = await readLocalPrefs(storage, 'rider-2')
  assert.equal(first.ride, false)
  assert.equal(first.promotions, true)
  assert.equal(first.marketing, true)
  assert.deepEqual(first.quiet, {
    dnd: true,
    scheduleEnabled: false,
    start: '23:10',
    end: '07:00',
  })
  assert.equal(first.billing, true)
  assert.equal(second.billing, false)
  assert.equal(second.ride, true)
  assert.equal(storage.data[PREFS_KEY('rider-1')], JSON.stringify({
    ride: false,
    promotions: true,
    quiet: { dnd: true, start: '23:10' },
    marketing: true,
  }))
  first.ride = true
  const reread = await readLocalPrefs(storage, 'rider-1')
  assert.equal(reread.ride, false)
})

test('readLocalPrefs uses the anon key and returns fresh defaults when nothing is stored', async () => {
  const storage = memoryStorage()
  for (const userId of [undefined, null, '']) {
    const prefs = await readLocalPrefs(storage, userId)
    assert.deepEqual(prefs, defaults())
    assert.notEqual(prefs, DEFAULT_NOTIFICATION_PREFS)
  }
  await writeLocalPrefs(storage, '', { system: false })
  assert.equal(await storage.getItem(PREFS_KEY('anon')), JSON.stringify({ system: false }))
  assert.equal((await readLocalPrefs(storage, null)).system, false)
  assert.deepEqual(await readLocalPrefs(memoryStorage(), 'missing'), defaults())
})

test('readLocalPrefs falls back to defaults for malformed storage', async () => {
  assert.deepEqual(await readLocalPrefs(null, 'rider-1'), defaults())
  assert.deepEqual(await readLocalPrefs(undefined, 'rider-1'), defaults())

  const badJson = memoryStorage({ [PREFS_KEY('rider-1')]: '{ride:false' })
  assert.deepEqual(await readLocalPrefs(badJson, 'rider-1'), defaults())

  const jsonNull = memoryStorage({ [PREFS_KEY('rider-1')]: 'null' })
  assert.deepEqual(await readLocalPrefs(jsonNull, 'rider-1'), defaults())

  const jsonString = memoryStorage({ [PREFS_KEY('rider-1')]: '"night"' })
  assert.deepEqual(await readLocalPrefs(jsonString, 'rider-1'), defaults())

  const empty = memoryStorage({ [PREFS_KEY('rider-1')]: '' })
  assert.deepEqual(await readLocalPrefs(empty, 'rider-1'), defaults())

  // BUG?: a stored JSON array is parsed and then treated as a prefs object.
  const jsonArray = memoryStorage({ [PREFS_KEY('rider-1')]: '["ride"]' })
  const fromArray = await readLocalPrefs(jsonArray, 'rider-1')
  assert.equal(fromArray[0], 'ride')
  assert.equal(fromArray.billing, true)

  const exploding = {
    async getItem() {
      throw new Error('disk unreadable')
    },
  }
  assert.deepEqual(await readLocalPrefs(exploding, 'rider-1'), defaults())
})

test('writeLocalPrefs mirrors the value it is given and swallows storage errors', async () => {
  assert.equal(await writeLocalPrefs(null, 'rider-1', { ride: false }), undefined)

  const storage = memoryStorage()
  // BUG?: writeLocalPrefs does not normalize, so the mirror can hold a partial document.
  assert.equal(await writeLocalPrefs(storage, 'rider-1', { ride: false }), undefined)
  assert.equal(storage.data[PREFS_KEY('rider-1')], JSON.stringify({ ride: false }))

  await writeLocalPrefs(storage, 'rider-1', null)
  assert.equal(storage.data[PREFS_KEY('rider-1')], 'null')
  assert.deepEqual(await readLocalPrefs(storage, 'rider-1'), defaults())

  const circular = { ride: true }
  circular.self = circular
  const full = {
    async setItem() {
      throw new Error('disk full')
    },
  }
  await assert.doesNotReject(() => writeLocalPrefs(storage, 'rider-1', circular))
  await assert.doesNotReject(() => writeLocalPrefs(full, 'rider-1', { ride: false }))
  assert.equal(storage.data[PREFS_KEY('rider-1')], 'null')
})

test('fetchNotificationPrefs stays on the device mirror without a client or user', async () => {
  const storage = memoryStorage({
    [PREFS_KEY('rider-1')]: JSON.stringify({ ride: false, extra: 1 }),
    [PREFS_KEY('')]: JSON.stringify({ system: false }),
  })
  const { client, calls } = fakeSupabase({
    read() {
      throw new Error('should not query')
    },
  })

  const signedOut = await fetchNotificationPrefs(client, storage, '')
  assert.equal(signedOut.persisted, false)
  assert.equal(signedOut.softFail, null)
  assert.equal(signedOut.prefs.system, false)
  assert.equal(signedOut.prefs.ride, true)
  assert.equal(signedOut.prefs.extra, undefined)

  const noClient = await fetchNotificationPrefs(null, storage, 'rider-1')
  assert.equal(noClient.persisted, false)
  assert.equal(noClient.softFail, null)
  assert.equal(noClient.prefs.ride, false)
  assert.equal(noClient.prefs.extra, 1)
  assert.equal(noClient.prefs.billing, true)
  assert.equal(calls.length, 0)
  assert.equal(storage.data[PREFS_KEY('rider-1')], JSON.stringify({ ride: false, extra: 1 }))
  assert.equal(await fetchNotificationPrefs(undefined, null, null).then((result) => result.prefs.promotions), false)
})

test('fetchNotificationPrefs prefers a stored profile object and refreshes the mirror', async () => {
  const remote = {
    ride: false,
    promotions: 1,
    marketing: true,
    quiet: { dnd: true, start: '23:00', note: 'drop me' },
  }
  const storage = memoryStorage({
    [PREFS_KEY('rider-1')]: JSON.stringify({ billing: false }),
    [PREFS_KEY('other')]: JSON.stringify({ system: false }),
  })
  const { client, calls } = fakeSupabase({
    read: () => ({ data: { notification_prefs: remote }, error: null }),
  })

  const result = await fetchNotificationPrefs(client, storage, 'rider-1')
  assert.equal(result.persisted, true)
  assert.equal(result.softFail, null)
  assert.equal(result.prefs.ride, false)
  assert.equal(result.prefs.billing, true)
  assert.equal(result.prefs.promotions, true)
  assert.equal(result.prefs.marketing, true)
  assert.deepEqual(result.prefs.quiet, {
    dnd: true,
    scheduleEnabled: false,
    start: '23:00',
    end: '07:00',
  })
  assert.equal(remote.quiet.note, 'drop me')
  assert.notEqual(result.prefs, remote)
  assert.deepEqual(calls.map((call) => call.op), ['from', 'select', 'eq', 'maybeSingle'])
  assert.equal(calls[0].table, 'profiles')
  assert.equal(calls[1].columns, 'notification_prefs')
  assert.deepEqual(calls[2], { op: 'eq', column: 'id', value: 'rider-1' })
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY('rider-1')]), result.prefs)
  assert.equal(storage.data[PREFS_KEY('other')], JSON.stringify({ system: false }))
})

test('fetchNotificationPrefs keeps the local mirror when the profile has no prefs object', async () => {
  const storage = memoryStorage({
    [PREFS_KEY('rider-1')]: JSON.stringify({ friends: false }),
  })
  for (const row of [null, { notification_prefs: null }, { notification_prefs: 'legacy' }, {}]) {
    const { client } = fakeSupabase({
      read: () => ({ data: row, error: null }),
    })
    const result = await fetchNotificationPrefs(client, storage, 'rider-1')
    assert.equal(result.persisted, false)
    assert.equal(result.softFail, null)
    assert.equal(result.prefs.friends, false)
    assert.equal(result.prefs.ride, true)
  }
  assert.equal(storage.data[PREFS_KEY('rider-1')], JSON.stringify({ friends: false }))

  const { client } = fakeSupabase({
    read: () => ({ data: null, error: null }),
  })
  const missingUser = await fetchNotificationPrefs(client, null, 'rider-1')
  assert.deepEqual(missingUser.prefs, defaults())
  assert.equal(missingUser.persisted, false)
})

test('fetchNotificationPrefs treats an empty object and an array as a saved record', async () => {
  const storage = memoryStorage({
    [PREFS_KEY('rider-1')]: JSON.stringify({ ride: false, promotions: true }),
  })
  const empty = fakeSupabase({
    read: () => ({ data: { notification_prefs: {} }, error: null }),
  })
  // BUG?: {} is truthy, so an empty profile object replaces a richer on-device mirror with defaults.
  const wiped = await fetchNotificationPrefs(empty.client, storage, 'rider-1')
  assert.equal(wiped.persisted, true)
  assert.deepEqual(wiped.prefs, defaults())
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY('rider-1')]), defaults())

  const listed = fakeSupabase({
    read: () => ({ data: { notification_prefs: ['ride'] }, error: null }),
  })
  // BUG?: an array passes the object check and is persisted back to device storage.
  const fromArray = await fetchNotificationPrefs(listed.client, memoryStorage(), 'rider-1')
  assert.equal(fromArray.persisted, true)
  assert.equal(fromArray.prefs[0], 'ride')
  assert.equal(fromArray.prefs.billing, true)
})

test('fetchNotificationPrefs soft-fails on a query error and on a thrown client', async () => {
  const storage = memoryStorage({
    [PREFS_KEY('rider-1')]: JSON.stringify({ system: false }),
  })
  const errored = fakeSupabase({
    read: () => ({ data: { notification_prefs: { ride: false } }, error: { message: 'permission denied' } }),
  })
  const denied = await fetchNotificationPrefs(errored.client, storage, 'rider-1')
  assert.deepEqual(denied, {
    prefs: { ...defaults(), system: false },
    persisted: false,
    softFail: 'permission denied',
  })
  assert.equal(storage.data[PREFS_KEY('rider-1')], JSON.stringify({ system: false }))

  // BUG?: a truthy error with no message sets softFail to undefined. A thrown failure uses a fallback string.
  const blank = fakeSupabase({
    read: () => ({ data: null, error: { code: '42501' } }),
  })
  const nameless = await fetchNotificationPrefs(blank.client, storage, 'rider-1')
  assert.equal(nameless.persisted, false)
  assert.equal(nameless.softFail, undefined)
  assert.equal(nameless.prefs.system, false)

  const emptyMessage = fakeSupabase({
    read: () => ({ data: null, error: { message: '' } }),
  })
  assert.equal((await fetchNotificationPrefs(emptyMessage.client, storage, 'rider-1')).softFail, '')

  const thrown = fakeSupabase({
    read() {
      throw new Error('network down')
    },
  })
  const failed = await fetchNotificationPrefs(thrown.client, storage, 'rider-1')
  assert.equal(failed.persisted, false)
  assert.equal(failed.softFail, 'network down')
  assert.equal(failed.prefs.system, false)

  const stringThrow = {
    from() {
      throw 'offline'
    },
  }
  const unstructured = await fetchNotificationPrefs(stringThrow, storage, 'rider-1')
  assert.equal(unstructured.softFail, 'fetch failed')
  assert.equal(unstructured.persisted, false)
  assert.equal(unstructured.prefs.system, false)

  const unreadable = {
    async getItem() {
      throw new Error('disk unreadable')
    },
    async setItem(key, value) {
      this.written = { key, value }
    },
  }
  const recovered = fakeSupabase({
    read: () => ({ data: { notification_prefs: { billing: false } }, error: null }),
  })
  const prefs = await fetchNotificationPrefs(recovered.client, unreadable, 'rider-1')
  assert.equal(prefs.persisted, true)
  assert.equal(prefs.prefs.billing, false)
  assert.equal(prefs.softFail, null)
  assert.equal(unreadable.written.key, PREFS_KEY('rider-1'))
})

test('saveNotificationPrefs normalizes, mirrors locally, and skips the profile without a client or user', async () => {
  const storage = memoryStorage()
  const { client, calls } = fakeSupabase({
    write() {
      throw new Error('should not update')
    },
  })
  const skipped = await saveNotificationPrefs(client, storage, '', {
    promotions: 'false',
    ride: 'no',
    quiet: { start: '99:99', dnd: 'false' },
    mystery: true,
  })

  assert.equal(skipped.ok, true)
  assert.equal(skipped.persisted, false)
  assert.equal(skipped.softFail, null)
  // BUG?: these strings survive normalization as enabled.
  assert.equal(skipped.prefs.promotions, true)
  assert.equal(skipped.prefs.ride, true)
  assert.equal(skipped.prefs.quiet.dnd, true)
  assert.equal(skipped.prefs.quiet.start, '22:00')
  assert.equal(skipped.prefs.mystery, true)
  assert.equal(calls.length, 0)
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY('anon')]), skipped.prefs)

  const noClient = await saveNotificationPrefs(null, null, 'rider-1', null)
  assert.equal(noClient.ok, true)
  assert.equal(noClient.persisted, false)
  assert.equal(noClient.softFail, null)
  assert.deepEqual(noClient.prefs, defaults())
  assert.notEqual(noClient.prefs, DEFAULT_NOTIFICATION_PREFS)
})

test('saveNotificationPrefs writes the normalized record to profiles', async () => {
  const storage = memoryStorage()
  let written
  const { client, calls } = fakeSupabase({
    write(payload) {
      written = payload
      return { error: null }
    },
  })
  const before = Date.now()
  const result = await saveNotificationPrefs(client, storage, 'rider-1', {
    ride: false,
    friends_carpool: false,
    quiet: { scheduleEnabled: true, start: '20:00', end: '05:30' },
  })
  const after = Date.now()

  assert.equal(result.ok, true)
  assert.equal(result.persisted, true)
  assert.equal(result.softFail, null)
  assert.equal(result.prefs.ride, false)
  assert.equal(result.prefs.friends, false)
  assert.equal(result.prefs.friends_carpool, false)
  assert.deepEqual(result.prefs.quiet, {
    dnd: false,
    scheduleEnabled: true,
    start: '20:00',
    end: '05:30',
  })
  assert.equal(written.notification_prefs, result.prefs)
  assert.match(written.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  const stamp = Date.parse(written.updated_at)
  assert.equal(stamp >= before - 1000 && stamp <= after + 1000, true)
  assert.deepEqual(calls.map((call) => call.op), ['from', 'update', 'eq'])
  assert.equal(calls[0].table, 'profiles')
  assert.deepEqual(calls[2], { op: 'eq', column: 'id', value: 'rider-1' })
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY('rider-1')]), result.prefs)
})

test('saveNotificationPrefs keeps the local mirror when the profile write fails', async () => {
  const storage = memoryStorage({
    [PREFS_KEY('rider-1')]: JSON.stringify({ ride: true }),
  })
  const errored = fakeSupabase({
    write: () => ({ error: { message: 'column notification_prefs does not exist' } }),
  })
  const failed = await saveNotificationPrefs(errored.client, storage, 'rider-1', { billing: false })
  assert.equal(failed.ok, true)
  assert.equal(failed.persisted, false)
  assert.equal(failed.softFail, 'column notification_prefs does not exist')
  assert.equal(failed.prefs.billing, false)
  assert.equal(failed.prefs.ride, true)
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY('rider-1')]), failed.prefs)

  const blank = fakeSupabase({
    write: () => ({ error: { message: '' } }),
  })
  const nameless = await saveNotificationPrefs(blank.client, storage, 'rider-1', { system: false })
  assert.equal(nameless.ok, true)
  assert.equal(nameless.persisted, false)
  assert.equal(nameless.softFail, 'notification_prefs write failed')
  assert.equal(nameless.prefs.system, false)

  const thrown = fakeSupabase({
    write() {
      throw new Error('timeout')
    },
  })
  const rejected = await saveNotificationPrefs(thrown.client, storage, 'rider-1', { friends: false })
  assert.equal(rejected.ok, true)
  assert.equal(rejected.persisted, false)
  assert.equal(rejected.softFail, 'timeout')
  assert.equal(rejected.prefs.friends, false)
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY('rider-1')]), rejected.prefs)

  const stringThrow = {
    from() {
      throw 'offline'
    },
  }
  const unstructured = await saveNotificationPrefs(stringThrow, storage, 'rider-1', { promotions: true })
  assert.equal(unstructured.ok, true)
  assert.equal(unstructured.persisted, false)
  assert.equal(unstructured.softFail, 'write failed')
  assert.equal(unstructured.prefs.promotions, true)
  assert.equal(JSON.parse(storage.data[PREFS_KEY('rider-1')]).promotions, true)

  const full = memoryStorage()
  full.setItem = async () => {
    throw new Error('disk full')
  }
  const stillRemote = fakeSupabase({
    write: () => ({ error: null }),
  })
  const saved = await saveNotificationPrefs(stillRemote.client, full, 'rider-1', { ride: false })
  assert.equal(saved.persisted, true)
  assert.equal(saved.prefs.ride, false)
  assert.equal(saved.softFail, null)
})
