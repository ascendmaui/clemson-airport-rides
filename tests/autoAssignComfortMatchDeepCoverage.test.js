/**
 * Direct coverage for server/autoAssign.js and server/comfortMatch.js.
 * Both are live dispatch code (requestDriverTrip, riderSwitch, driverOfferDesk,
 * matchingRebroadcast) that only had indirect coverage before.
 * Uses an in-memory Supabase fake. No network, no real credentials.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { listAssignableDrivers, nextQueuedDriver } from '../server/autoAssign.js'
import {
  comfortDecision,
  comfortEmptyMessage,
  filterAssignableDrivers,
  loadComfortProfiles,
} from '../server/comfortMatch.js'

const D1 = '11111111-1111-4111-8111-111111111111'
const D2 = '22222222-2222-4222-8222-222222222222'
const D3 = '33333333-3333-4333-8333-333333333333'
const D4 = '44444444-4444-4444-8444-444444444444'
const RIDER = '99999999-9999-4999-8999-999999999999'

/**
 * Minimal chainable Supabase fake.
 * errors: { [table]: (selectCols, filters) => error|null }
 */
function fakeSb(tables = {}, errors = {}) {
  const calls = []
  function from(table) {
    const state = { table, cols: '*', filters: [] }
    const run = () => {
      calls.push({ table: state.table, cols: state.cols, filters: state.filters.slice() })
      const errFn = errors[state.table]
      const err = typeof errFn === 'function' ? errFn(state.cols, state.filters) : null
      if (err) return { data: null, error: err }
      let rows = (tables[state.table] || []).slice()
      for (const f of state.filters) {
        if (f.op === 'eq') rows = rows.filter((r) => r[f.col] === f.val)
        if (f.op === 'in') rows = rows.filter((r) => f.val.includes(r[f.col]))
      }
      return { data: rows, error: null }
    }
    const builder = {
      select(cols) { state.cols = cols; return builder },
      eq(col, val) { state.filters.push({ op: 'eq', col, val }); return builder },
      in(col, val) { state.filters.push({ op: 'in', col, val }); return builder },
      async maybeSingle() {
        const res = run()
        if (res.error) return res
        return { data: res.data[0] || null, error: null }
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return builder
  }
  return { from, calls }
}

function approved(...ids) {
  return ids.map((id) => ({ profile_id: id, onboarding_status: 'approved' }))
}

function online(...ids) {
  return ids.map((id) => ({ driver_id: id, online: true }))
}

// ---------------------------------------------------------------------------
// nextQueuedDriver
// ---------------------------------------------------------------------------

test('nextQueuedDriver: returns the next online driver after the current one', () => {
  assert.equal(nextQueuedDriver([D1, D2, D3], D1, [D2, D3]), D2)
  assert.equal(nextQueuedDriver([D1, D2, D3], D1, new Set([D3])), D3)
})

test('nextQueuedDriver: starts from the top when the current driver is not in the queue', () => {
  assert.equal(nextQueuedDriver([D1, D2], 'someone-else', [D1, D2]), D1)
  assert.equal(nextQueuedDriver([D1, D2], null, [D2]), D2)
})

test('nextQueuedDriver: returns null at the end of the queue and never wraps around', () => {
  assert.equal(nextQueuedDriver([D1, D2], D2, [D1, D2]), null)
  assert.equal(nextQueuedDriver([D1, D2, D3], D1, [D1]), null)
})

test('nextQueuedDriver: ignores non-string queue entries and tolerates bad inputs', () => {
  assert.equal(nextQueuedDriver([null, 42, '', D2], null, [D2]), D2)
  assert.equal(nextQueuedDriver(null, D1, [D1]), null)
  assert.equal(nextQueuedDriver('not-a-list', D1, [D1]), null)
  assert.equal(nextQueuedDriver([D1, D2], D1, null), null)
  assert.equal(nextQueuedDriver([D1, D2], D1, undefined), null)
})

// ---------------------------------------------------------------------------
// filterAssignableDrivers / comfortEmptyMessage
// ---------------------------------------------------------------------------

test('filterAssignableDrivers: leaves the list untouched when comfort columns are unknown', () => {
  const drivers = [{ id: D1, gender_identity: 'man', women_only_matching: false }]
  const out = filterAssignableDrivers(drivers, { gender_identity: 'woman', women_only_matching: true }, { comfortKnown: false })
  assert.deepEqual(out.drivers, drivers)
  assert.equal(out.womenOnlyBlocked, false)
  assert.equal(out.riderWantsWomenDrivers, false)
})

test('filterAssignableDrivers: rider women-only keeps only women drivers', () => {
  const drivers = [
    { id: D1, gender_identity: 'man' },
    { id: D2, gender_identity: 'woman' },
    { id: D3, gender_identity: 'unspecified' },
  ]
  const out = filterAssignableDrivers(drivers, { gender_identity: 'woman', women_only_matching: true })
  assert.deepEqual(out.drivers.map((d) => d.id), [D2])
  assert.equal(out.womenOnlyBlocked, false)
  assert.equal(out.riderWantsWomenDrivers, true)
})

test('filterAssignableDrivers: driver women-only preference excludes riders who are not women', () => {
  const drivers = [
    { id: D1, gender_identity: 'woman', women_only_matching: true },
    { id: D2, gender_identity: 'man', women_only_matching: false },
  ]
  const man = filterAssignableDrivers(drivers, { gender_identity: 'man' })
  assert.deepEqual(man.drivers.map((d) => d.id), [D2])
  const unknownRider = filterAssignableDrivers(drivers, null)
  assert.deepEqual(unknownRider.drivers.map((d) => d.id), [D2])
  const woman = filterAssignableDrivers(drivers, { gender_identity: 'woman' })
  assert.deepEqual(woman.drivers.map((d) => d.id), [D1, D2])
})

test('filterAssignableDrivers: womenOnlyBlocked only when every candidate was removed', () => {
  const drivers = [{ id: D1, gender_identity: 'man' }]
  const blocked = filterAssignableDrivers(drivers, { gender_identity: 'woman', women_only_matching: true })
  assert.equal(blocked.drivers.length, 0)
  assert.equal(blocked.womenOnlyBlocked, true)
  const empty = filterAssignableDrivers([], { gender_identity: 'woman', women_only_matching: true })
  assert.equal(empty.womenOnlyBlocked, false)
  assert.deepEqual(filterAssignableDrivers(null, null).drivers, [])
})

test('filterAssignableDrivers: a women-only flag on a non-woman rider is ignored (sanitized)', () => {
  const drivers = [{ id: D1, gender_identity: 'man' }]
  const out = filterAssignableDrivers(drivers, { gender_identity: 'man', women_only_matching: true })
  assert.deepEqual(out.drivers.map((d) => d.id), [D1])
  assert.equal(out.riderWantsWomenDrivers, false)
})

test('comfortEmptyMessage: copy depends on whether the rider asked for women drivers', () => {
  assert.match(comfortEmptyMessage({ riderWantsWomenDrivers: true }), /No women drivers are online/)
  assert.match(comfortEmptyMessage({ riderWantsWomenDrivers: false }), /taking women passengers/)
  assert.match(comfortEmptyMessage(null), /taking women passengers/)
})

// ---------------------------------------------------------------------------
// loadComfortProfiles
// ---------------------------------------------------------------------------

test('loadComfortProfiles: dedupes ids and skips the query when nothing is left', async () => {
  const sb = fakeSb({ profiles: [] })
  const out = await loadComfortProfiles(sb, [null, '', undefined])
  assert.deepEqual(out, { rows: [], unavailable: false, error: null })
  assert.equal(sb.calls.length, 0)
  const none = await loadComfortProfiles(sb, undefined)
  assert.deepEqual(none.rows, [])

  await loadComfortProfiles(sb, [D1, D1, D2])
  assert.deepEqual(sb.calls[0].filters[0].val, [D1, D2])
})

test('loadComfortProfiles: falls back to id/email when comfort columns are missing', async () => {
  const sb = fakeSb(
    { profiles: [{ id: D1, email: 'a@example.test' }] },
    { profiles: (cols) => (cols.includes('gender_identity') ? { message: 'column profiles.gender_identity does not exist' } : null) },
  )
  const out = await loadComfortProfiles(sb, [D1])
  assert.equal(out.unavailable, true)
  assert.equal(out.error, null)
  assert.deepEqual(out.rows.map((r) => r.id), [D1])
  assert.equal(sb.calls.length, 2)
  assert.equal(sb.calls[1].cols, 'id, email')
})

test('loadComfortProfiles: reports fallback and non-column errors', async () => {
  const both = fakeSb({}, { profiles: (cols) => (cols.includes('gender_identity') ? { message: 'schema cache miss' } : { message: 'basic read failed' }) })
  const a = await loadComfortProfiles(both, [D1])
  assert.deepEqual(a, { rows: [], unavailable: true, error: 'basic read failed' })

  const basicNoMsg = fakeSb({}, { profiles: (cols) => (cols.includes('gender_identity') ? { message: 'column missing' } : {}) })
  const b = await loadComfortProfiles(basicNoMsg, [D1])
  assert.equal(b.error, 'Could not read drivers')

  const hard = fakeSb({}, { profiles: () => ({ message: 'permission denied' }) })
  const c = await loadComfortProfiles(hard, [D1])
  assert.deepEqual(c, { rows: [], unavailable: false, error: 'permission denied' })

  const hardNoMsg = fakeSb({}, { profiles: () => ({}) })
  const d = await loadComfortProfiles(hardNoMsg, [D1])
  assert.equal(d.error, 'Could not read drivers')
})

// ---------------------------------------------------------------------------
// comfortDecision
// ---------------------------------------------------------------------------

test('comfortDecision: ok when both sides allow the pair', async () => {
  const sb = fakeSb({
    profiles: [
      { id: RIDER, gender_identity: 'man', women_only_matching: false },
      { id: D1, gender_identity: 'man', women_only_matching: false },
    ],
  })
  assert.deepEqual(await comfortDecision(sb, RIDER, D1), { ok: true })
})

test('comfortDecision: 409 with rider-side copy when the rider wants women drivers', async () => {
  const sb = fakeSb({
    profiles: [
      { id: RIDER, gender_identity: 'woman', women_only_matching: true },
      { id: D1, gender_identity: 'man' },
    ],
  })
  const out = await comfortDecision(sb, RIDER, D1)
  assert.equal(out.ok, false)
  assert.equal(out.status, 409)
  assert.equal(out.code, 'women_only_mismatch')
  assert.match(out.error, /women-driver comfort preference on your profile/)
})

test('comfortDecision: 409 with driver-side copy when the driver takes women passengers only', async () => {
  const sb = fakeSb({
    profiles: [
      { id: RIDER, gender_identity: 'nonbinary' },
      { id: D1, gender_identity: 'woman', women_only_matching: true },
    ],
  })
  const out = await comfortDecision(sb, RIDER, D1)
  assert.equal(out.status, 409)
  assert.match(out.error, /taking women passengers/)
})

test('comfortDecision: missing rider or driver id reads nothing for that side', async () => {
  const sb = fakeSb({ profiles: [{ id: D1, gender_identity: 'man' }] })
  assert.deepEqual(await comfortDecision(sb, null, D1), { ok: true })
  assert.deepEqual(await comfortDecision(sb, RIDER, null), { ok: true })
  assert.equal(sb.calls.length, 2)
})

test('comfortDecision: a profile row that does not exist counts as unspecified', async () => {
  const sb = fakeSb({ profiles: [{ id: D1, gender_identity: 'woman', women_only_matching: true }] })
  const out = await comfortDecision(sb, RIDER, D1)
  assert.equal(out.status, 409)
})

test('comfortDecision: missing comfort columns allow the match and flag unavailable', async () => {
  const sb = fakeSb({}, { profiles: () => ({ message: 'column "women_only_matching" does not exist' }) })
  assert.deepEqual(await comfortDecision(sb, RIDER, D1), { ok: true, unavailable: true })
})

test('comfortDecision: other read errors fail closed with 500 for either side', async () => {
  const riderFails = fakeSb({}, { profiles: (_c, f) => (f[0].val === RIDER ? { message: 'timeout' } : null) })
  const a = await comfortDecision(riderFails, RIDER, D1)
  assert.deepEqual(a, { ok: false, status: 500, error: 'timeout', code: 'comfort_preference_unavailable' })

  const driverFails = fakeSb({}, { profiles: (_c, f) => (f[0].val === D1 ? {} : null) })
  const b = await comfortDecision(driverFails, RIDER, D1)
  assert.equal(b.status, 500)
  assert.equal(b.error, 'Could not read profile')
})

// ---------------------------------------------------------------------------
// listAssignableDrivers
// ---------------------------------------------------------------------------

test('listAssignableDrivers: no client returns no_client', async () => {
  assert.deepEqual(await listAssignableDrivers(null), { drivers: [], error: 'no_client' })
})

test('listAssignableDrivers: driver_status errors propagate with a fallback message', async () => {
  const a = await listAssignableDrivers(fakeSb({}, { driver_status: () => ({ message: 'status down' }) }))
  assert.deepEqual(a, { drivers: [], error: 'status down' })
  const b = await listAssignableDrivers(fakeSb({}, { driver_status: () => ({}) }))
  assert.equal(b.error, 'Could not read online drivers')
})

test('listAssignableDrivers: nobody online short-circuits before the approval read', async () => {
  const sb = fakeSb({ driver_status: [{ driver_id: D1, online: false }] })
  const out = await listAssignableDrivers(sb)
  assert.deepEqual(out, { drivers: [], error: null })
  assert.ok(!sb.calls.some((c) => c.table === 'driver_applications'))
})

test('listAssignableDrivers: drops simulated, preview, blank, and duplicate driver ids', async () => {
  const sb = fakeSb({
    driver_status: [
      ...online(D1, D1, 'sim-busy-7', 'demo-marcus'),
      { driver_id: null, online: true },
      { driver_id: '', online: true },
    ],
    driver_applications: approved(D1),
    profiles: [{ id: D1, email: 'd1@example.test' }],
  })
  const out = await listAssignableDrivers(sb)
  assert.deepEqual(out.drivers.map((d) => d.id), [D1])
  const approvalCall = sb.calls.find((c) => c.table === 'driver_applications')
  assert.deepEqual(approvalCall.filters[0].val, [D1])
})

test('listAssignableDrivers: approval read error is returned', async () => {
  const sb = fakeSb({ driver_status: online(D1) }, { driver_applications: () => ({ message: 'apps down' }) })
  assert.deepEqual(await listAssignableDrivers(sb), { drivers: [], error: 'apps down' })
})

test('listAssignableDrivers: unapproved non-staff drivers are not offered rides', async () => {
  const sb = fakeSb({
    driver_status: online(D1, D2),
    driver_applications: [
      { profile_id: D1, onboarding_status: 'approved' },
      { profile_id: D2, onboarding_status: 'submitted' },
    ],
    profiles: [
      { id: D1, email: 'd1@example.test' },
      { id: D2, email: 'd2@example.test', role: 'driver', is_admin: false },
    ],
    admin_users: [],
  })
  const out = await listAssignableDrivers(sb)
  assert.deepEqual(out.drivers.map((d) => d.id), [D1])
})

test('listAssignableDrivers: an admin without an approved application may still receive rides', async () => {
  const sb = fakeSb({
    driver_status: online(D2),
    driver_applications: [],
    profiles: [{ id: D2, email: 'ops@example.test', is_admin: true }],
    admin_users: [],
  })
  const out = await listAssignableDrivers(sb)
  assert.deepEqual(out.drivers.map((d) => d.id), [D2])
})

test('listAssignableDrivers: nobody approved returns an empty list without reading profiles', async () => {
  const sb = fakeSb({
    driver_status: online(D1),
    driver_applications: [{ profile_id: D1, onboarding_status: 'rejected' }],
    profiles: [{ id: D1, email: 'd1@example.test' }],
    admin_users: [],
  })
  const out = await listAssignableDrivers(sb)
  assert.deepEqual(out, { drivers: [], error: null })
  assert.ok(!sb.calls.some((c) => c.table === 'profiles' && c.cols.includes('gender_identity')))
})

test('listAssignableDrivers: profile read error is returned', async () => {
  const sb = fakeSb(
    { driver_status: online(D1), driver_applications: approved(D1) },
    { profiles: () => ({ message: 'profiles down' }) },
  )
  assert.deepEqual(await listAssignableDrivers(sb), { drivers: [], error: 'profiles down' })
})

test('listAssignableDrivers: default order is John, then Kim, then everyone else by id; emails are not returned', async () => {
  const sb = fakeSb({
    driver_status: online(D4, D3, D2, D1),
    driver_applications: approved(D1, D2, D3, D4),
    profiles: [
      { id: D4, email: 'zed@example.test' },
      { id: D3, email: 'KimUberMaui@gmail.com' },
      { id: D2, email: 'johnmatveyev@gmail.com' },
      { id: D1, email: 'amy@example.test' },
    ],
  })
  const out = await listAssignableDrivers(sb)
  assert.equal(out.error, null)
  assert.deepEqual(out.drivers.map((d) => d.id), [D2, D3, D1, D4])
  assert.deepEqual(out.drivers.map((d) => d.dispatchRank), [0, 1, 2, 2])
  for (const driver of out.drivers) {
    assert.deepEqual(Object.keys(driver).sort(), ['dispatchRank', 'id'])
  }
})

test('listAssignableDrivers: preferred drivers lead, then favorites, then default order', async () => {
  const sb = fakeSb({
    driver_status: online(D1, D2, D3, D4),
    driver_applications: approved(D1, D2, D3, D4),
    profiles: [
      { id: D1, email: 'johnmatveyev@gmail.com' },
      { id: D2, email: 'b@example.test' },
      { id: D3, email: 'c@example.test' },
      { id: D4, email: 'd@example.test' },
    ],
  })
  const out = await listAssignableDrivers(sb, { preferredIds: [D4], favoriteIds: [D3, 'demo-marcus', 'not-a-uuid'] })
  assert.deepEqual(out.drivers.map((d) => d.id), [D4, D3, D1, D2])
})

test('listAssignableDrivers: a preferred id that is not online is not invented', async () => {
  const sb = fakeSb({
    driver_status: online(D1),
    driver_applications: approved(D1),
    profiles: [{ id: D1, email: 'a@example.test' }],
  })
  const out = await listAssignableDrivers(sb, { preferredIds: [D2], favoriteIds: [D3] })
  assert.deepEqual(out.drivers.map((d) => d.id), [D1])
})

test('listAssignableDrivers: comfort tier keeps only comfort-class vehicles', async () => {
  const sb = fakeSb({
    driver_status: online(D1, D2, D3),
    driver_applications: approved(D1, D2, D3),
    profiles: [
      { id: D1, email: 'a@example.test' },
      { id: D2, email: 'b@example.test' },
      { id: D3, email: 'c@example.test' },
    ],
    vehicles: [
      { driver_id: D1, service_class: 'Comfort', tier: 'standard' },
      { driver_id: D2, service_class: 'standard', tier: ' COMFORT ' },
      { driver_id: D3, service_class: 'standard', tier: 'standard' },
    ],
  })
  const out = await listAssignableDrivers(sb, { tier: 'comfort' })
  assert.deepEqual(out.drivers.map((d) => d.id), [D1, D2])
})

test('listAssignableDrivers: comfort tier falls back to vehicles.tier when service_class is missing', async () => {
  const sb = fakeSb(
    {
      driver_status: online(D1, D2),
      driver_applications: approved(D1, D2),
      profiles: [{ id: D1, email: 'a@example.test' }, { id: D2, email: 'b@example.test' }],
      vehicles: [
        { driver_id: D1, tier: 'standard' },
        { driver_id: D2, tier: 'comfort' },
      ],
    },
    { vehicles: (cols) => (cols.includes('service_class') ? { message: 'column vehicles.service_class does not exist' } : null) },
  )
  const out = await listAssignableDrivers(sb, { tier: 'comfort' })
  assert.deepEqual(out.drivers.map((d) => d.id), [D2])
})

test('listAssignableDrivers: comfort vehicle read errors are returned (primary and fallback)', async () => {
  const base = {
    driver_status: online(D1),
    driver_applications: approved(D1),
    profiles: [{ id: D1, email: 'a@example.test' }],
  }
  const hard = await listAssignableDrivers(fakeSb(base, { vehicles: () => ({ message: 'vehicles down' }) }), { tier: 'comfort' })
  assert.deepEqual(hard, { drivers: [], error: 'vehicles down' })

  const hardNoMsg = await listAssignableDrivers(fakeSb(base, { vehicles: () => ({}) }), { tier: 'comfort' })
  assert.equal(hardNoMsg.error, 'Could not read vehicles')

  const fallbackFails = await listAssignableDrivers(
    fakeSb(base, { vehicles: (cols) => (cols.includes('service_class') ? { message: 'schema cache' } : { message: 'fallback down' }) }),
    { tier: 'comfort' },
  )
  assert.deepEqual(fallbackFails, { drivers: [], error: 'fallback down' })
})

test('listAssignableDrivers: standard and carpool tiers do not read vehicles', async () => {
  for (const tier of ['standard', 'carpool', 'wait']) {
    const sb = fakeSb({
      driver_status: online(D1),
      driver_applications: approved(D1),
      profiles: [{ id: D1, email: 'a@example.test' }],
      vehicles: [],
    })
    const out = await listAssignableDrivers(sb, { tier })
    assert.deepEqual(out.drivers.map((d) => d.id), [D1], tier)
    assert.ok(!sb.calls.some((c) => c.table === 'vehicles'), tier)
  }
})

test('listAssignableDrivers: comfort tier with no qualifying vehicles is empty, not an error', async () => {
  const sb = fakeSb({
    driver_status: online(D1),
    driver_applications: approved(D1),
    profiles: [{ id: D1, email: 'a@example.test' }],
    vehicles: [],
  })
  const out = await listAssignableDrivers(sb, { tier: 'comfort' })
  assert.equal(out.error, null)
  assert.deepEqual(out.drivers, [])
  assert.equal(out.womenOnlyBlocked, false)
})

test('listAssignableDrivers: rider women-only preference filters drivers and reports blocked', async () => {
  const sb = fakeSb({
    driver_status: online(D1, D2),
    driver_applications: approved(D1, D2),
    profiles: [
      { id: D1, email: 'a@example.test', gender_identity: 'man' },
      { id: D2, email: 'b@example.test', gender_identity: 'woman' },
      { id: RIDER, email: 'r@example.test', gender_identity: 'woman', women_only_matching: true },
    ],
  })
  const out = await listAssignableDrivers(sb, { riderId: RIDER })
  assert.deepEqual(out.drivers.map((d) => d.id), [D2])
  assert.equal(out.riderWantsWomenDrivers, true)
  assert.equal(out.womenOnlyBlocked, false)

  const none = fakeSb({
    driver_status: online(D1),
    driver_applications: approved(D1),
    profiles: [
      { id: D1, email: 'a@example.test', gender_identity: 'man' },
      { id: RIDER, gender_identity: 'woman', women_only_matching: true },
    ],
  })
  const blocked = await listAssignableDrivers(none, { riderId: RIDER })
  assert.deepEqual(blocked.drivers, [])
  assert.equal(blocked.womenOnlyBlocked, true)
  assert.match(comfortEmptyMessage(blocked), /No women drivers are online/)
})

test('listAssignableDrivers: drivers taking women passengers only are skipped for other riders', async () => {
  const sb = fakeSb({
    driver_status: online(D1, D2),
    driver_applications: approved(D1, D2),
    profiles: [
      { id: D1, email: 'a@example.test', gender_identity: 'woman', women_only_matching: true },
      { id: D2, email: 'b@example.test', gender_identity: 'man' },
      { id: RIDER, gender_identity: 'man' },
    ],
  })
  const out = await listAssignableDrivers(sb, { riderId: RIDER })
  assert.deepEqual(out.drivers.map((d) => d.id), [D2])
  assert.equal(out.riderWantsWomenDrivers, false)
})

test('listAssignableDrivers: comfort columns missing means no filtering and no rider read', async () => {
  const sb = fakeSb(
    {
      driver_status: online(D1),
      driver_applications: approved(D1),
      profiles: [{ id: D1, email: 'a@example.test' }, { id: RIDER, email: 'r@example.test' }],
    },
    { profiles: (cols) => (cols.includes('gender_identity') ? { message: 'column profiles.women_only_matching does not exist' } : null) },
  )
  const out = await listAssignableDrivers(sb, { riderId: RIDER })
  assert.deepEqual(out.drivers.map((d) => d.id), [D1])
  assert.equal(out.womenOnlyBlocked, false)
  const riderReads = sb.calls.filter((c) => c.table === 'profiles' && c.filters.some((f) => f.op === 'eq' && f.val === RIDER))
  assert.equal(riderReads.length, 0)
})

test('listAssignableDrivers: rider read column error is tolerated; other rider errors are returned', async () => {
  const tables = {
    driver_status: online(D1),
    driver_applications: approved(D1),
    profiles: [{ id: D1, email: 'a@example.test', gender_identity: 'man' }],
  }
  const riderEq = (f) => f.some((x) => x.op === 'eq' && x.val === RIDER)

  const tolerated = await listAssignableDrivers(
    fakeSb(tables, { profiles: (_c, f) => (riderEq(f) ? { message: 'gender_identity missing' } : null) }),
    { riderId: RIDER },
  )
  assert.equal(tolerated.error, null)
  assert.deepEqual(tolerated.drivers.map((d) => d.id), [D1])

  const failed = await listAssignableDrivers(
    fakeSb(tables, { profiles: (_c, f) => (riderEq(f) ? { message: 'rider timeout' } : null) }),
    { riderId: RIDER },
  )
  assert.deepEqual(failed, { drivers: [], error: 'rider timeout' })

  const failedNoMsg = await listAssignableDrivers(
    fakeSb(tables, { profiles: (_c, f) => (riderEq(f) ? {} : null) }),
    { riderId: RIDER },
  )
  assert.equal(failedNoMsg.error, 'Could not read the rider')
})
