import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeDriver,
  driverApproach,
  driverAvailabilityLine,
  fetchDriverApplication,
  fetchDriversByIds,
  fetchOnlineDrivers,
  formatDriverDistance,
  groupDriversForPicker,
  loadFavoriteDriverIds,
  normalizeFavoriteDriverIds,
  OPEN_POOL_COPY,
  PREFERRED_CANCELED_COPY,
  PREFERRED_MATCH_COPY,
  PREFERRED_OFFLINE_COPY,
  preferredTripFields,
  requestDriverTrip,
  saveFavoriteDriverIds,
  setDriverOnline,
  sortPreferredDrivers,
} from './drivers.js'
import { GSP, STADIUM } from './places.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    async setItem(key, val) {
      map.set(key, String(val))
    },
    _map: map,
  }
}

function makeFakeSupabase({
  profiles = [],
  driverStatus = [],
  vehicles = [],
  driverApplications = [],
  approvedIds = null,
  rpcError = null,
  profilesError = null,
  profilesNarrowError = null,
  statusError = null,
  vehiclesError = null,
  applicationError = null,
  upsertStatusError = null,
  updateProfileError = null,
  sessionToken = null,
} = {}) {
  return {
    auth: {
      getSession: async () => ({
        data: sessionToken ? { session: { access_token: sessionToken } } : null,
        error: null,
      }),
    },
    rpc: async (name, args) => {
      if (rpcError) return { data: null, error: rpcError }
      if (name === 'list_approved_driver_ids') {
        const ids = args?.ids || []
        const approvedSet = approvedIds ? new Set(approvedIds) : new Set(ids)
        const matched = ids.filter((id) => approvedSet.has(id)).map((id) => ({ profile_id: id }))
        return { data: matched, error: null }
      }
      return { data: null, error: { message: `Unknown RPC ${name}` } }
    },
    from(table) {
      if (table === 'profiles') {
        return {
          select(cols = '') {
            const isNarrow = cols.includes('id, full_name') && !cols.includes('standing')
            if (isNarrow && profilesNarrowError) return Promise.resolve({ data: null, error: profilesNarrowError })
            if (!isNarrow && profilesError) {
              return {
                eq: () => ({ maybeSingle: async () => ({ data: null, error: profilesError }) }),
                in: async () => ({ data: null, error: profilesError }),
                then: (resolve) => resolve({ data: null, error: profilesError }),
              }
            }
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => {
                    const found = profiles.find((p) => p[col] === val)
                    return { data: found || null, error: null }
                  },
                }
              },
              in(col, vals) {
                return Promise.resolve({
                  data: profiles.filter((p) => vals.includes(p[col])),
                  error: null,
                })
              },
            }
          },
          update(patch) {
            return {
              eq(col, val) {
                if (updateProfileError) return Promise.resolve({ error: updateProfileError })
                const target = profiles.find((p) => p[col] === val)
                if (target) Object.assign(target, patch)
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      }
      if (table === 'driver_status') {
        return {
          select() {
            if (statusError) {
              return {
                eq: async () => ({ data: null, error: statusError }),
                in: async () => ({ data: null, error: statusError }),
              }
            }
            return {
              eq(col, val) {
                return Promise.resolve({
                  data: driverStatus.filter((s) => s[col] === val),
                  error: null,
                })
              },
              in(col, vals) {
                return Promise.resolve({
                  data: driverStatus.filter((s) => vals.includes(s[col])),
                  error: null,
                })
              },
            }
          },
          upsert(row) {
            if (upsertStatusError) return Promise.resolve({ error: upsertStatusError })
            const existingIdx = driverStatus.findIndex((s) => s.driver_id === row.driver_id)
            if (existingIdx >= 0) driverStatus[existingIdx] = { ...driverStatus[existingIdx], ...row }
            else driverStatus.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'vehicles') {
        return {
          select() {
            return {
              in(col, vals) {
                if (vehiclesError) return Promise.resolve({ data: null, error: vehiclesError })
                return Promise.resolve({
                  data: vehicles.filter((v) => vals.includes(v[col])),
                  error: null,
                })
              },
            }
          },
        }
      }
      if (table === 'driver_applications') {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => {
                    if (applicationError) return { data: null, error: applicationError }
                    const found = driverApplications.find((a) => a[col] === val)
                    return { data: found || null, error: null }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

// ---------------------------------------------------------------------------
// 1. Copy constants & preferredTripFields
// ---------------------------------------------------------------------------

test('preferred-driver copy says a decline does not auto-match', () => {
  assert.match(PREFERRED_MATCH_COPY, /does not auto-match/)
  assert.match(PREFERRED_MATCH_COPY, /canceled/)
  assert.match(PREFERRED_OFFLINE_COPY, /does not auto-match/)
  assert.match(PREFERRED_CANCELED_COPY, /not offered to another driver/)
  assert.match(OPEN_POOL_COPY, /first available driver/)
  assert.deepEqual(preferredTripFields(A), { preferred_driver_id: A, match: 'preferred' })
  assert.deepEqual(preferredTripFields(undefined), { preferred_driver_id: undefined, match: 'preferred' })
})

// ---------------------------------------------------------------------------
// 2. normalizeFavoriteDriverIds
// ---------------------------------------------------------------------------

test('normalizeFavoriteDriverIds cleans, dedupes, validates, and caps UUIDs', () => {
  // trims whitespace, accepts case variants, deduplicates, and skips invalid strings or non-strings
  assert.deepEqual(
    normalizeFavoriteDriverIds(['  ' + A + ' ', A, '', 3, false, null, undefined, {}, 'invalid-uuid', B]),
    [A, B],
  )
  // non-array raw inputs return empty list
  assert.deepEqual(normalizeFavoriteDriverIds(null), [])
  assert.deepEqual(normalizeFavoriteDriverIds(undefined), [])
  assert.deepEqual(normalizeFavoriteDriverIds('not an array'), [])
  assert.deepEqual(normalizeFavoriteDriverIds(123), [])
  assert.deepEqual(normalizeFavoriteDriverIds({}), [])

  // caps at FAVORITE_CAP (12)
  const fifteenUuids = Array.from({ length: 15 }, (_, i) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  )
  const normalized = normalizeFavoriteDriverIds(fifteenUuids)
  assert.equal(normalized.length, 12)
  assert.equal(normalized[0], fifteenUuids[0])
  assert.equal(normalized[11], fifteenUuids[11])
})

// ---------------------------------------------------------------------------
// 3. driverApproach and formatDriverDistance
// ---------------------------------------------------------------------------

test('driverApproach calculates distance and campus-pace ETA or returns empty for missing pins', () => {
  const near = driverApproach(
    { lat: 34.6788, lng: -82.843 },
    { lat: 34.6933, lng: -82.843 },
  )
  assert.ok(near.distanceMi > 0.8 && near.distanceMi < 1.3)
  assert.ok(near.etaMin >= 1 && near.etaMin <= 6)

  // missing or null coordinates return empty { etaMin: null, distanceMi: null }
  assert.deepEqual(driverApproach(null, { lat: 1, lng: 2 }), { etaMin: null, distanceMi: null })
  assert.deepEqual(driverApproach({ lat: 1, lng: 2 }, null), { etaMin: null, distanceMi: null })
  assert.deepEqual(driverApproach({ lat: null, lng: -82.8 }, { lat: 1, lng: 2 }), { etaMin: null, distanceMi: null })
  assert.deepEqual(driverApproach({ lat: 34.6, lng: null }, { lat: 1, lng: 2 }), { etaMin: null, distanceMi: null })
  assert.deepEqual(driverApproach({ lat: 34.6, lng: -82.8 }, { lat: null, lng: 2 }), { etaMin: null, distanceMi: null })
  assert.deepEqual(driverApproach({ lat: 34.6, lng: -82.8 }, { lat: 1, lng: undefined }), { etaMin: null, distanceMi: null })
  assert.deepEqual(driverApproach({ lat: 'not-a-number', lng: -82.8 }, { lat: 1, lng: 2 }), { etaMin: null, distanceMi: null })

  // BUG?: identical coordinates result in 1 min ETA floor (Math.max(1, 0)) rather than 0 min
  const sameSpot = driverApproach({ lat: 34.6788, lng: -82.843 }, { lat: 34.6788, lng: -82.843 })
  assert.equal(sameSpot.distanceMi, 0)
  assert.equal(sameSpot.etaMin, 1)

  // Supports { latitude, longitude } coordinate format as well
  const fullNamedSpot = driverApproach(
    { latitude: 34.6788, longitude: -82.843 },
    { latitude: 34.6933, longitude: -82.843 },
  )
  assert.equal(fullNamedSpot.distanceMi, near.distanceMi)
  assert.equal(fullNamedSpot.etaMin, near.etaMin)
})

test('formatDriverDistance formats miles with one decimal, floors under 0.1 mi, and rejects non-finites', () => {
  assert.equal(formatDriverDistance(0.04), 'under 0.1 mi')
  assert.equal(formatDriverDistance(0), 'under 0.1 mi')
  assert.equal(formatDriverDistance(1.24), '1.2 mi')
  assert.equal(formatDriverDistance('2.55'), '2.5 mi' || '2.6 mi') // Number('2.55').toFixed(1)
  assert.equal(formatDriverDistance(10), '10.0 mi')

  // BUG?: negative distance numbers return 'under 0.1 mi' rather than null or handling invalid coordinates
  assert.equal(formatDriverDistance(-0.5), 'under 0.1 mi')

  // non-finite, null, or undefined values return null
  assert.equal(formatDriverDistance(null), null)
  assert.equal(formatDriverDistance(undefined), null)
  assert.equal(formatDriverDistance(NaN), null)
  assert.equal(formatDriverDistance(Infinity), null)
  assert.equal(formatDriverDistance('abc'), null)
})

// ---------------------------------------------------------------------------
// 4. driverAvailabilityLine and describeDriver
// ---------------------------------------------------------------------------

test('driverAvailabilityLine reflects online status, priority mode, and stale location timing', () => {
  assert.equal(driverAvailabilityLine(null), 'Offline')
  assert.equal(driverAvailabilityLine(undefined), 'Offline')
  assert.equal(driverAvailabilityLine({ online: false }), 'Offline')
  assert.equal(driverAvailabilityLine({ online: true, priorityMode: false }), 'Online')
  assert.equal(driverAvailabilityLine({ online: true, priorityMode: true }), 'Online · Priority')

  // Stale location check: > 10 minutes (600,000 ms) is stale
  const now = new Date('2026-09-24T12:00:00.000Z')
  const freshTime = new Date('2026-09-24T11:55:00.000Z').toISOString() // 5 min ago
  const staleTime = new Date('2026-09-24T11:45:00.000Z').toISOString() // 15 min ago

  assert.equal(driverAvailabilityLine({ online: true, updatedAt: freshTime }, now), 'Online')
  assert.equal(
    driverAvailabilityLine({ online: true, priorityMode: false, updatedAt: staleTime }, now),
    'Online · location may be stale',
  )
  assert.equal(
    driverAvailabilityLine({ online: true, priorityMode: true, updatedAt: staleTime }, now),
    'Online · Priority · location may be stale',
  )

  // invalid updatedAt date string does not produce stale bit
  assert.equal(
    driverAvailabilityLine({ online: true, updatedAt: 'not-a-valid-date' }, now),
    'Online',
  )
})

test('describeDriver builds card presentation, formatting ratings, approach, and offline states', () => {
  const pickup = { lat: 34.69, lng: -82.84 }

  // Offline driver with location and rating
  const offline = describeDriver({
    online: false,
    lat: 34.68,
    lng: -82.84,
    ratingAvg: 4.8,
    ratingCount: 3,
  }, pickup)
  assert.equal(offline.etaLabel, null)
  assert.equal(offline.distanceLabel, null)
  assert.equal(offline.availability, 'Offline')
  assert.equal(offline.ratingLabel, '4.8 · 3 ratings')
  assert.ok(offline.distanceMi > 0)
  assert.ok(offline.etaMin >= 1)

  // Online driver with 0 ratings displays 'New driver'
  const fresh = describeDriver({
    online: true,
    lat: 34.6788,
    lng: -82.843,
    ratingCount: 0,
  }, { lat: 34.6788, lng: -82.843 })
  assert.equal(fresh.ratingLabel, 'New driver')
  assert.equal(fresh.etaLabel, '1 min')
  assert.equal(fresh.distanceLabel, 'under 0.1 mi')
  assert.equal(fresh.availability, 'Online')

  // Online driver with null ratingAvg also displays 'New driver'
  const nullAvg = describeDriver({
    online: true,
    lat: 34.6788,
    lng: -82.843,
    ratingAvg: null,
    ratingCount: 5,
  }, { lat: 34.6788, lng: -82.843 })
  assert.equal(nullAvg.ratingLabel, 'New driver')

  // Driver with null / missing object
  const empty = describeDriver(null, pickup)
  assert.equal(empty.etaMin, null)
  assert.equal(empty.distanceMi, null)
  assert.equal(empty.etaLabel, null)
  assert.equal(empty.distanceLabel, null)
  assert.equal(empty.availability, 'Offline')
  assert.equal(empty.ratingLabel, 'New driver')
})

// ---------------------------------------------------------------------------
// 5. sortPreferredDrivers and groupDriversForPicker
// ---------------------------------------------------------------------------

test('sortPreferredDrivers prioritizes favorites, online status, ETA, and alphabetical order', () => {
  const drivers = [
    { id: B, name: 'Bea', online: true, lat: 34.7, lng: -82.84 },
    { id: A, name: 'Ada', online: false, lat: 34.68, lng: -82.84 },
    { id: C, name: 'Cam', online: true, lat: 34.679, lng: -82.843 },
    { id: D, name: 'Dan', online: true, lat: 34.75, lng: -82.84 },
  ]
  const pickup = { lat: 34.6788, lng: -82.843 }

  // Favorite (A) comes first even though offline; among online non-favorites, Cam is closer than Bea, Bea is closer than Dan
  const sorted = sortPreferredDrivers(drivers, [A], pickup)
  assert.equal(sorted[0].id, A)
  assert.equal(sorted[1].id, C)
  assert.equal(sorted[2].id, B)
  assert.equal(sorted[3].id, D)

  // Empty or missing lists
  assert.deepEqual(sortPreferredDrivers(null, [A], pickup), [])
  assert.deepEqual(sortPreferredDrivers(undefined, null, pickup), [])

  // Missing coordinates fallback to ETA 999 and sort alphabetically
  const withoutCoords = [
    { id: '11111111-0000-4000-8000-000000000001', name: 'Zack', online: true },
    { id: '11111111-0000-4000-8000-000000000002', name: 'Aaron', online: true },
    { id: '11111111-0000-4000-8000-000000000003', name: null, online: true },
  ]
  const sortedNoCoords = sortPreferredDrivers(withoutCoords, [], pickup)
  assert.equal(sortedNoCoords[0].name, null) // String(null || '') is '' which sorts before 'Aaron'
  assert.equal(sortedNoCoords[1].name, 'Aaron')
  assert.equal(sortedNoCoords[2].name, 'Zack')
})

test('groupDriversForPicker separates favorites from non-favorite online drivers', () => {
  const drivers = [
    { id: A, name: 'Ada', online: false },
    { id: B, name: 'Bea', online: true },
    { id: C, name: 'Cam', online: true },
    { id: D, name: 'Dan', online: false },
  ]
  // A is favorite (offline) -> preferred
  // B is favorite (online) -> preferred (NOT in online)
  // C is non-favorite (online) -> online
  // D is non-favorite (offline) -> excluded
  const groups = groupDriversForPicker(drivers, [A, B])
  assert.deepEqual(groups.preferred.map((d) => d.id), [A, B])
  assert.deepEqual(groups.online.map((d) => d.id), [C])

  // null or empty drivers list
  assert.deepEqual(groupDriversForPicker(null, [A]), { preferred: [], online: [] })
  assert.deepEqual(groupDriversForPicker([], null), { preferred: [], online: [] })
})

// ---------------------------------------------------------------------------
// 6. loadFavoriteDriverIds
// ---------------------------------------------------------------------------

test('loadFavoriteDriverIds handles missing supabase or userId by reading local storage', async () => {
  const storageWithIds = makeStorage({ 'rider.preferredDrivers.anon': JSON.stringify([A, B]) })

  // Missing supabase reads from phone storage
  const resNoClient = await loadFavoriteDriverIds(null, storageWithIds, null)
  assert.deepEqual(resNoClient.ids, [A, B])
  assert.equal(resNoClient.source, 'phone')
  assert.equal(resNoClient.note, 'Saved on this phone.')

  // Missing userId reads phone storage under 'anon' key
  const supabase = makeFakeSupabase()
  const resNoUser = await loadFavoriteDriverIds(supabase, storageWithIds, null)
  assert.deepEqual(resNoUser.ids, [A, B])
  assert.equal(resNoUser.source, 'phone')

  // Empty storage returns source 'none' and null note
  const emptyStorage = makeStorage()
  const resEmpty = await loadFavoriteDriverIds(supabase, emptyStorage, null)
  assert.deepEqual(resEmpty.ids, [])
  assert.equal(resEmpty.source, 'none')
  assert.equal(resEmpty.note, null)

  // Null storage or storage throwing does not fail
  const faultyStorage = { getItem: async () => { throw new Error('Storage corrupted') } }
  const resCorrupt = await loadFavoriteDriverIds(null, faultyStorage, null)
  assert.deepEqual(resCorrupt.ids, [])
  assert.equal(resCorrupt.source, 'none')
})

test('loadFavoriteDriverIds retrieves remote profile favorites and mirrors to storage', async () => {
  const storage = makeStorage()
  const supabase = makeFakeSupabase({
    profiles: [{ id: 'user-1', favorite_driver_ids: [A, C] }],
  })

  const res = await loadFavoriteDriverIds(supabase, storage, 'user-1')
  assert.deepEqual(res.ids, [A, C])
  assert.equal(res.source, 'account')
  assert.equal(res.note, null)

  // Verified mirrored to local phone storage
  const savedLocal = await storage.getItem('rider.preferredDrivers.user-1')
  assert.deepEqual(JSON.parse(savedLocal), [A, C])
})

test('loadFavoriteDriverIds falls back to phone storage on empty remote or DB error', async () => {
  const storage = makeStorage({ 'rider.preferredDrivers.user-2': JSON.stringify([B]) })

  // Remote profile has null / empty favorites -> falls back to local storage
  const supabaseEmptyRemote = makeFakeSupabase({
    profiles: [{ id: 'user-2', favorite_driver_ids: [] }],
  })
  const resEmpty = await loadFavoriteDriverIds(supabaseEmptyRemote, storage, 'user-2')
  assert.deepEqual(resEmpty.ids, [B])
  assert.equal(resEmpty.source, 'phone')
  assert.equal(resEmpty.note, 'Saved on this phone.')

  // BUG?: redundant error check in loadFavoriteDriverIds; line 153 and line 156 have identical fallback return
  // DB schema cache error (column missing) -> falls back to phone storage
  const supabaseSchemaErr = makeFakeSupabase({
    profilesError: { message: 'column favorite_driver_ids does not exist in schema cache' },
  })
  const resSchemaErr = await loadFavoriteDriverIds(supabaseSchemaErr, storage, 'user-2')
  assert.deepEqual(resSchemaErr.ids, [B])
  assert.equal(resSchemaErr.source, 'phone')

  // DB generic connection error -> falls back to phone storage
  const supabaseDbErr = makeFakeSupabase({
    profilesError: { message: 'Connection timeout' },
  })
  const resDbErr = await loadFavoriteDriverIds(supabaseDbErr, storage, 'user-2')
  assert.deepEqual(resDbErr.ids, [B])
  assert.equal(resDbErr.source, 'phone')
})

// ---------------------------------------------------------------------------
// 7. saveFavoriteDriverIds
// ---------------------------------------------------------------------------

test('saveFavoriteDriverIds handles missing supabase or userId by saving locally only', async () => {
  const storage = makeStorage()

  // Missing supabase saves only to phone
  const resNoClient = await saveFavoriteDriverIds(null, storage, 'user-1', [A, B])
  assert.deepEqual(resNoClient.ids, [A, B])
  assert.equal(resNoClient.persisted, false)
  assert.equal(resNoClient.note, 'Saved on this phone.')

  // Missing userId saves to phone under 'anon' key
  const supabase = makeFakeSupabase()
  const resNoUser = await saveFavoriteDriverIds(supabase, storage, null, [C])
  assert.deepEqual(resNoUser.ids, [C])
  assert.equal(resNoUser.persisted, false)
  assert.equal(resNoUser.note, 'Saved on this phone.')

  // Null storage or storage throwing does not break return
  const brokenStorage = { setItem: async () => { throw new Error('Disk full') } }
  const resBroken = await saveFavoriteDriverIds(null, brokenStorage, 'user-1', [A])
  assert.deepEqual(resBroken.ids, [A])
  assert.equal(resBroken.persisted, false)
})

test('saveFavoriteDriverIds updates remote account and writes to storage', async () => {
  const storage = makeStorage()
  const profiles = [{ id: 'user-1', favorite_driver_ids: [] }]
  const supabase = makeFakeSupabase({ profiles })

  const res = await saveFavoriteDriverIds(supabase, storage, 'user-1', [A, B])
  assert.deepEqual(res.ids, [A, B])
  assert.equal(res.persisted, true)
  assert.equal(res.note, 'Saved to your account.')

  // Verified in fake DB profile row
  assert.deepEqual(profiles[0].favorite_driver_ids, [A, B])
  assert.ok(profiles[0].updated_at)

  // Verified in local storage
  const stored = await storage.getItem('rider.preferredDrivers.user-1')
  assert.deepEqual(JSON.parse(stored), [A, B])
})

test('saveFavoriteDriverIds falls back to persisted: false when remote update fails', async () => {
  const storage = makeStorage()
  // BUG?: local storage is updated even when remote persistence fails, leaving phone and account out of sync on DB failure
  const supabase = makeFakeSupabase({
    updateProfileError: { message: 'Network disconnected' },
  })

  const res = await saveFavoriteDriverIds(supabase, storage, 'user-1', [A])
  assert.deepEqual(res.ids, [A])
  assert.equal(res.persisted, false)
  assert.equal(res.note, 'Saved on this phone.')

  // Check that storage was nonetheless updated
  const stored = await storage.getItem('rider.preferredDrivers.user-1')
  assert.deepEqual(JSON.parse(stored), [A])
})

// ---------------------------------------------------------------------------
// 8. fetchOnlineDrivers
// ---------------------------------------------------------------------------

test('fetchOnlineDrivers requires supabase configuration and reports query errors', async () => {
  // Missing supabase
  const resNoSupabase = await fetchOnlineDrivers(null)
  assert.deepEqual(resNoSupabase.drivers, [])
  assert.equal(resNoSupabase.error, 'Supabase not configured')

  // Driver status table query error
  const supabaseStatusErr = makeFakeSupabase({
    statusError: { message: 'driver_status table unavailable' },
  })
  const resStatusErr = await fetchOnlineDrivers(supabaseStatusErr)
  assert.deepEqual(resStatusErr.drivers, [])
  assert.equal(resStatusErr.error, 'driver_status table unavailable')

  // RPC error
  const supabaseRpcErr = makeFakeSupabase({
    driverStatus: [{ driver_id: A, online: true }],
    rpcError: { message: 'RPC execution failed' },
  })
  const resRpcErr = await fetchOnlineDrivers(supabaseRpcErr)
  assert.deepEqual(resRpcErr.drivers, [])
  assert.equal(resRpcErr.error, 'RPC execution failed')

  // Profile query non-schema error
  const supabaseProfileErr = makeFakeSupabase({
    driverStatus: [{ driver_id: A, online: true }],
    profilesError: { message: 'Database connection failed' },
  })
  const resProfileErr = await fetchOnlineDrivers(supabaseProfileErr)
  assert.deepEqual(resProfileErr.drivers, [])
  assert.equal(resProfileErr.error, 'Database connection failed')
})

test('fetchOnlineDrivers returns empty list when no drivers are online or approved', async () => {
  // No online drivers
  const supabaseNoOnline = makeFakeSupabase({ driverStatus: [] })
  const resNoOnline = await fetchOnlineDrivers(supabaseNoOnline)
  assert.deepEqual(resNoOnline.drivers, [])
  assert.equal(resNoOnline.error, null)

  // Drivers online but none are approved
  const supabaseUnapproved = makeFakeSupabase({
    driverStatus: [{ driver_id: A, online: true }],
    approvedIds: [], // none approved
  })
  const resUnapproved = await fetchOnlineDrivers(supabaseUnapproved)
  assert.deepEqual(resUnapproved.drivers, [])
  assert.equal(resUnapproved.error, null)
})

test('fetchOnlineDrivers happy path maps driver profile, status, vehicle, and filters restricted drivers', async () => {
  const driverStatus = [
    {
      driver_id: A,
      online: true,
      priority_mode: true,
      lat: 34.6788,
      lng: -82.843,
      heading: 180,
      unlock_progress: 3,
      unlock_target: 5,
      updated_at: '2026-09-24T12:00:00.000Z',
    },
    {
      driver_id: B,
      online: true,
      priority_mode: false,
      lat: 34.68,
      lng: -82.84,
      heading: null,
      unlock_progress: null,
      unlock_target: null,
      updated_at: null,
    },
    {
      driver_id: C, // Restricted driver
      online: true,
      priority_mode: false,
      lat: 34.69,
      lng: -82.84,
      heading: null,
      unlock_progress: null,
      unlock_target: null,
      updated_at: null,
    },
  ]
  const profiles = [
    {
      id: A,
      full_name: 'Jordan Lee',
      phone: '8645550100',
      email: 'jordan@clemson.edu',
      avatar_url: 'https://example.com/avatar.jpg',
      role: 'driver',
      rating_avg: 4.95,
      rating_count: 42,
      standing: 'good',
    },
    {
      id: B,
      full_name: 'Sam Taylor',
      phone: null,
      email: 'sam@clemson.edu',
      avatar_url: null,
      role: 'driver',
      rating_avg: null,
      rating_count: 0,
      standing: null,
    },
    {
      id: C,
      full_name: 'Restricted Rob',
      standing: 'restricted',
    },
  ]
  const vehicles = [
    {
      id: 'v-1',
      driver_id: A,
      make: 'Tesla',
      model: 'Model 3',
      color: 'Midnight Silver',
      plate: 'TGR-123',
      seats: 4,
      is_tesla: true,
      autonomous_capable: false,
      tier: 'tesla',
    },
  ]

  const supabase = makeFakeSupabase({ driverStatus, profiles, vehicles, approvedIds: [A, B, C] })
  const res = await fetchOnlineDrivers(supabase)

  assert.equal(res.error, null)
  assert.equal(res.drivers.length, 2) // C is omitted because standing === 'restricted'

  const driverA = res.drivers.find((d) => d.id === A)
  assert.equal(driverA.name, 'Jordan')
  assert.equal(driverA.ratingAvg, 4.95)
  assert.equal(driverA.ratingCount, 42)
  assert.equal(driverA.standing, 'good')
  assert.equal(driverA.phone, '8645550100')
  assert.equal(driverA.avatarUrl, 'https://example.com/avatar.jpg')
  assert.equal(driverA.online, true)
  assert.equal(driverA.priorityMode, true)
  assert.equal(driverA.lat, 34.6788)
  assert.equal(driverA.lng, -82.843)
  assert.equal(driverA.heading, 180)
  assert.equal(driverA.unlockProgress, 3)
  assert.equal(driverA.unlockTarget, 5)
  assert.equal(driverA.vehicleLabel, 'Midnight Silver Tesla Model 3')
  assert.equal(driverA.plate, 'TGR-123')
  assert.equal(driverA.isTesla, true)
  assert.equal(driverA.tier, 'tesla')

  const driverB = res.drivers.find((d) => d.id === B)
  assert.equal(driverB.name, 'Sam')
  assert.equal(driverB.vehicleLabel, 'Vehicle TBD')
  assert.equal(driverB.plate, null)
  assert.equal(driverB.isTesla, false)
  assert.equal(driverB.tier, 'standard')
  assert.equal(driverB.standing, 'good') // derived from standingFromRatings(null, 0)
})

test('fetchOnlineDrivers falls back to narrow profile columns on schema cache error', async () => {
  const driverStatus = [{ driver_id: A, online: true }]
  const profiles = [
    { id: A, full_name: 'Taylor Swift', phone: '8645551989', email: 'taylor@clemson.edu', role: 'driver' },
  ]
  const supabase = makeFakeSupabase({
    driverStatus,
    profiles,
    profilesError: { message: 'column standing does not exist in schema cache' },
  })

  const res = await fetchOnlineDrivers(supabase)
  assert.equal(res.error, null)
  assert.equal(res.drivers.length, 1)
  assert.equal(res.drivers[0].name, 'Taylor')
  assert.equal(res.drivers[0].standing, 'good')
})

test('fetchOnlineDrivers handles vehicle query failure gracefully without crashing', async () => {
  // BUG?: vehicle query error (vehicleRes.error) is ignored, silently falling back to 'Vehicle TBD' instead of propagating error
  const driverStatus = [{ driver_id: A, online: true }]
  const profiles = [{ id: A, full_name: 'Casey Driver' }]
  const supabase = makeFakeSupabase({
    driverStatus,
    profiles,
    vehiclesError: { message: 'vehicles table locked' },
  })

  const res = await fetchOnlineDrivers(supabase)
  assert.equal(res.error, null)
  assert.equal(res.drivers.length, 1)
  assert.equal(res.drivers[0].vehicleLabel, 'Vehicle TBD')
})

// ---------------------------------------------------------------------------
// 9. fetchDriversByIds
// ---------------------------------------------------------------------------

test('fetchDriversByIds validates supabase, empty ids, and error conditions', async () => {
  // Missing supabase
  const resNoSupabase = await fetchDriversByIds(null, [A])
  assert.deepEqual(resNoSupabase.drivers, [])
  assert.equal(resNoSupabase.error, 'Supabase not configured')

  // Empty or invalid IDs
  const supabase = makeFakeSupabase()
  assert.deepEqual((await fetchDriversByIds(supabase, [])).drivers, [])
  assert.deepEqual((await fetchDriversByIds(supabase, null)).drivers, [])
  assert.deepEqual((await fetchDriversByIds(supabase, ['not-a-uuid'])).drivers, [])

  // RPC approved error
  const supabaseRpcErr = makeFakeSupabase({ rpcError: { message: 'RPC approval check failed' } })
  const resRpcErr = await fetchDriversByIds(supabaseRpcErr, [A])
  assert.deepEqual(resRpcErr.drivers, [])
  assert.equal(resRpcErr.error, 'RPC approval check failed')

  // None of the requested IDs are approved
  const supabaseNoneApproved = makeFakeSupabase({ approvedIds: [] })
  const resNoneApproved = await fetchDriversByIds(supabaseNoneApproved, [A])
  assert.deepEqual(resNoneApproved.drivers, [])
  assert.equal(resNoneApproved.error, null)

  // Status query error
  const supabaseStatusErr = makeFakeSupabase({
    statusError: { message: 'status query failed' },
    approvedIds: [A],
  })
  const resStatusErr = await fetchDriversByIds(supabaseStatusErr, [A])
  assert.deepEqual(resStatusErr.drivers, [])
  assert.equal(resStatusErr.error, 'status query failed')

  // Profile query error
  const supabaseProfileErr = makeFakeSupabase({
    profilesError: { message: 'profiles query failed' },
    approvedIds: [A],
  })
  const resProfileErr = await fetchDriversByIds(supabaseProfileErr, [A])
  assert.deepEqual(resProfileErr.drivers, [])
  assert.equal(resProfileErr.error, 'profiles query failed')
})

test('fetchDriversByIds includes offline drivers with synthesized default statuses', async () => {
  // Driver A is in driver_status (online: false, lat/lng present)
  // Driver B has NO driver_status row at all (synthesized offline row)
  const driverStatus = [
    { driver_id: A, online: false, priority_mode: false, lat: 34.68, lng: -82.84, updated_at: '2026-09-24T00:00:00Z' },
  ]
  const profiles = [
    { id: A, full_name: 'Alex Morgan' },
    { id: B, full_name: 'Blake Jordan' },
  ]
  const supabase = makeFakeSupabase({
    driverStatus,
    profiles,
    approvedIds: [A, B],
  })

  const res = await fetchDriversByIds(supabase, [A, B])
  assert.equal(res.error, null)
  assert.equal(res.drivers.length, 2)

  const driverA = res.drivers.find((d) => d.id === A)
  assert.equal(driverA.name, 'Alex')
  assert.equal(driverA.online, false)
  assert.equal(driverA.lat, 34.68)

  const driverB = res.drivers.find((d) => d.id === B)
  assert.equal(driverB.name, 'Blake')
  assert.equal(driverB.online, false)
  assert.equal(driverB.priorityMode, false)
  assert.equal(driverB.lat, null)
  assert.equal(driverB.lng, null)
  assert.equal(driverB.heading, null)
  assert.equal(driverB.vehicleLabel, 'Vehicle TBD')
})

// ---------------------------------------------------------------------------
// 10. setDriverOnline
// ---------------------------------------------------------------------------

test('setDriverOnline checks missing config, sign in, application approval, and upserts status', async () => {
  // Missing supabase
  await assert.rejects(
    () => setDriverOnline(null, A, true),
    /Supabase is not configured/,
  )

  // Missing driverId
  const supabase = makeFakeSupabase()
  await assert.rejects(
    () => setDriverOnline(supabase, null, true),
    /Sign in required/,
  )
  await assert.rejects(
    () => setDriverOnline(supabase, '', true),
    /Sign in required/,
  )

  // Gate error while querying application
  const supabaseGateErr = makeFakeSupabase({
    applicationError: { message: 'driver_applications table error' },
  })
  await assert.rejects(
    () => setDriverOnline(supabaseGateErr, A, true),
    /driver_applications table error/,
  )

  // Unapproved application throws approval gate error
  const supabasePending = makeFakeSupabase({
    driverApplications: [{ profile_id: A, onboarding_status: 'pending_review' }],
  })
  await assert.rejects(
    () => setDriverOnline(supabasePending, A, true),
    (err) => {
      assert.match(err.message, /Finish approval to go online/)
      assert.equal(err.application?.onboarding_status, 'pending_review')
      return true
    },
  )

  // Missing application row also throws approval gate error
  const supabaseNoApp = makeFakeSupabase({ driverApplications: [] })
  await assert.rejects(
    () => setDriverOnline(supabaseNoApp, A, true),
    (err) => {
      assert.match(err.message, /Finish approval to go online/)
      assert.equal(err.application, null)
      return true
    },
  )

  // Approved driver goes online successfully
  const driverStatus = []
  const supabaseApproved = makeFakeSupabase({
    driverApplications: [{ profile_id: A, onboarding_status: 'approved' }],
    driverStatus,
  })
  const onlineRes = await setDriverOnline(supabaseApproved, A, true)
  assert.deepEqual(onlineRes, { ok: true })
  assert.equal(driverStatus.length, 1)
  assert.equal(driverStatus[0].driver_id, A)
  assert.equal(driverStatus[0].online, true)

  // Going offline (online = false) does NOT check application gate
  const offlineRes = await setDriverOnline(supabasePending, A, false)
  assert.deepEqual(offlineRes, { ok: true })

  // Status upsert error
  const supabaseUpsertErr = makeFakeSupabase({
    upsertStatusError: { message: 'driver_status upsert failed' },
  })
  await assert.rejects(
    () => setDriverOnline(supabaseUpsertErr, A, false),
    /driver_status upsert failed/,
  )
})

// ---------------------------------------------------------------------------
// 11. fetchDriverApplication
// ---------------------------------------------------------------------------

test('fetchDriverApplication returns application data, null for missing id/client, and reports errors', async () => {
  // Missing supabase or driverId
  assert.deepEqual(await fetchDriverApplication(null, A), { application: null, error: null })
  const supabase = makeFakeSupabase()
  assert.deepEqual(await fetchDriverApplication(supabase, null), { application: null, error: null })
  assert.deepEqual(await fetchDriverApplication(supabase, ''), { application: null, error: null })

  // DB error
  const supabaseErr = makeFakeSupabase({
    applicationError: { message: 'Timeout fetching application' },
  })
  const resErr = await fetchDriverApplication(supabaseErr, A)
  assert.equal(resErr.application, null)
  assert.equal(resErr.error, 'Timeout fetching application')

  // Application found
  const appData = {
    profile_id: A,
    onboarding_status: 'pending_review',
    rejection_reason: null,
    submitted_at: '2026-09-24T00:00:00Z',
  }
  const supabaseWithApp = makeFakeSupabase({ driverApplications: [appData] })
  const resFound = await fetchDriverApplication(supabaseWithApp, A)
  assert.deepEqual(resFound.application, appData)
  assert.equal(resFound.error, null)

  // Application not found (returns null application, null error)
  const resNotFound = await fetchDriverApplication(supabaseWithApp, B)
  assert.equal(resNotFound.application, null)
  assert.equal(resNotFound.error, null)
})

// ---------------------------------------------------------------------------
// 12. requestDriverTrip
// ---------------------------------------------------------------------------

test('requestDriverTrip validates auth and driver selection', async () => {
  await assert.rejects(
    () => requestDriverTrip(null, { riderId: 'rider-1', driverId: A }),
    /Supabase is not configured/,
  )
  const supabase = makeFakeSupabase()
  await assert.rejects(
    () => requestDriverTrip(supabase, { riderId: null, driverId: A }),
    /Sign in required to request a driver/,
  )
  await assert.rejects(
    () => requestDriverTrip(supabase, { riderId: 'rider-1', driverId: null }),
    /Select a driver first/,
  )
})

test('requestDriverTrip happy path posts to stripe-payment-methods and returns trip', async () => {
  const originalFetch = globalThis.fetch
  try {
    let captured = null
    globalThis.fetch = async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          trip: { id: 'trip-preferred-1', status: 'requested', driver_id: A, fare_cents: 6500 },
        }),
      }
    }

    const supabase = makeFakeSupabase({ sessionToken: 'bearer-token-xyz' })
    const trip = await requestDriverTrip(supabase, {
      riderId: 'rider-1',
      driverId: A,
      dest: 'Greenville Downtown',
      destPoint: { latitude: 34.8526, longitude: -82.394 },
      pickupLabel: 'Sikes Hall',
      pickupPoint: { latitude: 34.6795, longitude: -82.8374 },
      tier: 'comfort',
      isStudent: true,
    })

    assert.equal(trip.id, 'trip-preferred-1')
    assert.equal(trip.driver_id, A)
    assert.match(captured.url, /\/api\/stripe-payment-methods\?action=request-driver$/)
    assert.equal(captured.options.headers.Authorization, 'Bearer bearer-token-xyz')
    assert.equal(captured.body.driverId, A)
    assert.equal(captured.body.dest, 'Greenville Downtown')
    assert.equal(captured.body.destLat, 34.8526)
    assert.equal(captured.body.destLng, -82.394)
    assert.equal(captured.body.pickupLabel, 'Sikes Hall')
    assert.equal(captured.body.pickupLat, 34.6795)
    assert.equal(captured.body.pickupLng, -82.8374)
    assert.equal(captured.body.tier, 'comfort')
    // isStudent is not passed to server in the request body
    assert.equal('isStudent' in captured.body, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requestDriverTrip applies default destination and stadium pickup points', async () => {
  const originalFetch = globalThis.fetch
  try {
    let captured = null
    globalThis.fetch = async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          trip: { id: 'trip-default', status: 'requested', driver_id: A },
        }),
      }
    }

    const supabase = makeFakeSupabase()
    // BUG?: requestDriverTrip expects { latitude, longitude } on pickupPoint/destPoint whereas driverApproach expects { lat, lng }
    const trip = await requestDriverTrip(supabase, {
      riderId: 'rider-1',
      driverId: A,
    })

    assert.equal(trip.id, 'trip-default')
    assert.equal(captured.body.dest, 'GSP Airport')
    assert.equal(captured.body.destLat, GSP.latitude)
    assert.equal(captured.body.destLng, GSP.longitude)
    assert.equal(captured.body.pickupLabel, 'Memorial Stadium')
    assert.equal(captured.body.pickupLat, STADIUM.latitude)
    assert.equal(captured.body.pickupLng, STADIUM.longitude)
    assert.equal(captured.body.tier, 'standard')

    // Also supports { lat, lng } on destPoint and pickupPoint
    await requestDriverTrip(supabase, {
      riderId: 'rider-1',
      driverId: A,
      destPoint: { lat: 34.8957, lng: -82.2189 },
      pickupPoint: { lat: 34.6788, lng: -82.843 },
    })
    assert.equal(captured.body.destLat, 34.8957)
    assert.equal(captured.body.destLng, -82.2189)
    assert.equal(captured.body.pickupLat, 34.6788)
    assert.equal(captured.body.pickupLng, -82.843)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requestDriverTrip propagates HTTP errors, missing trip responses, and network failures', async () => {
  const originalFetch = globalThis.fetch
  try {
    const supabase = makeFakeSupabase()

    // 1. API error HTTP 400
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Driver is offline' }),
    })
    await assert.rejects(
      () => requestDriverTrip(supabase, { riderId: 'rider-1', driverId: A }),
      /Driver is offline/,
    )

    // 2. Response 200 but trip is null / missing id
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ trip: null }),
    })
    await assert.rejects(
      () => requestDriverTrip(supabase, { riderId: 'rider-1', driverId: A }),
      /Could not request trip/,
    )

    // 3. Network fetch rejection
    globalThis.fetch = async () => {
      throw new Error('Network offline')
    }
    await assert.rejects(
      () => requestDriverTrip(supabase, { riderId: 'rider-1', driverId: A }),
      (err) => err.network === true && /Network offline/.test(err.message),
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
