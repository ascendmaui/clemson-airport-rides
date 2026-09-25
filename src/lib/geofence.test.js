import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { haversineMeters } from './rideGeometry.js'
import { registerLibImports } from '../../tests/fixtures/register-lib-imports.js'
import { setTestSupabase } from '../../tests/fixtures/supabase-stub.js'

// geofence.js imports `./supabase` without an extension. The hook resolves that
// and points it at a no-network stub.
await registerLibImports()

const { checkGeofence, distanceMeters, listGeofences } = await import('./geofence.js')

afterEach(() => {
  setTestSupabase(null)
})

function labelArgs(args) {
  return args.map((value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
    if (value === undefined) return 'undefined'
    return JSON.stringify(value)
  }).join(', ')
}

test('distanceMeters matches haversineMeters for real, antipodal, and non-finite coordinates', () => {
  const cases = [
    [34.6788, -82.8432, 34.8957, -82.2189],
    [34.6836, -82.8364, 34.6836, -82.8364],
    [0, 0, 0, 0],
    [90, 0, 90, 0],
    [-45.5, 120.25, -45.5, 120.25],
    [0, 0, 0, 180],
    [0, 0, 0, -180],
    [90, 0, -90, 0],
    [90, 10, -90, 50],
    [34.6836, -82.8364, -34.6836, 97.1636],
    [1, 1, -1, 181],
    [45, 10, -45, -170],
    ['34.6788', '-82.8432', '34.8957', '-82.2189'],
    [NaN, -82.84, 34.68, -82.84],
    [34.68, NaN, 34.68, -82.84],
    [34.68, -82.84, NaN, -82.84],
    [34.68, -82.84, 34.68, NaN],
    [undefined, -82.84, 34.68, -82.84],
    [Infinity, -82.84, 34.68, -82.84],
    [-Infinity, -82.84, 34.68, -82.84],
    ['not-a-number', -82.84, 34.68, -82.84],
    [null, -82.84, 34.68, -82.84],
    ['', -82.84, 34.68, -82.84],
    [false, -82.84, 34.68, -82.84],
  ]

  for (const args of cases) {
    assert.equal(distanceMeters(...args), haversineMeters(...args), labelArgs(args))
  }

  const same = distanceMeters(34.6836, -82.8364, 34.6836, -82.8364)
  assert.equal(same, 0)

  const half = Math.PI * 6371000
  const antipode = distanceMeters(0, 0, 0, 180)
  assert.ok(Number.isFinite(antipode))
  assert.ok(Math.abs(antipode - half) < 0.1)

  const stadiumToGsp = distanceMeters(34.6788, -82.8432, 34.8957, -82.2189)
  assert.ok(stadiumToGsp > 61500 && stadiumToGsp < 62500)

  assert.equal(distanceMeters(NaN, 0, 0, 1), null)
  assert.equal(distanceMeters(undefined, 0, 0, 1), null)
  assert.equal(distanceMeters('nope', 0, 0, 1), null)

  // BUG?: Number(null), Number(''), and Number(false) coerce to 0, so these
  // measure from the origin instead of returning null. Same quirk as haversineMeters.
  assert.equal(typeof distanceMeters(null, -82.84, 34.68, -82.84), 'number')
  assert.equal(typeof distanceMeters('', -82.84, 34.68, -82.84), 'number')
  assert.equal(typeof distanceMeters(false, -82.84, 34.68, -82.84), 'number')
})

function fenceClient(rows, error = null) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push(table)
      assert.equal(table, 'geofences')
      return {
        select(columns) {
          assert.equal(columns, 'id, name, center_lat, center_lng, radius_m, active')
          return this
        },
        eq(column, value) {
          assert.equal(column, 'active')
          assert.equal(value, true)
          return Promise.resolve({ data: rows, error })
        },
      }
    },
  }
}

test('checkGeofence rejects missing and non-finite coordinates before querying', async () => {
  let queried = false
  setTestSupabase({
    from() {
      queried = true
      throw new Error('should not query')
    },
  })

  for (const lat of [null, undefined, NaN, Infinity, -Infinity, 'not-a-number']) {
    queried = false
    const result = await checkGeofence(lat, -82.8364)
    assert.equal(queried, false, String(lat))
    assert.deepEqual(result, { inside: false, matches: [], error: 'missing coordinates' })
  }

  const missingLng = await checkGeofence(34.6836, undefined)
  assert.deepEqual(missingLng, { inside: false, matches: [], error: 'missing coordinates' })

  setTestSupabase(null)
  const offline = await checkGeofence(34.6836, -82.8364)
  assert.deepEqual(offline, { inside: false, matches: [], error: 'Supabase not configured' })

  // BUG?: '' and false become 0, so they are treated as real coordinates.
  const blank = await checkGeofence('', -82.8364)
  assert.equal(blank.error, 'Supabase not configured')
  const flag = await checkGeofence(false, -82.8364)
  assert.equal(flag.error, 'Supabase not configured')
})

test('checkGeofence keeps a point inside on the radius and skips non-finite centers', async () => {
  const centerLat = 34.6836
  const centerLng = -82.8364
  const metersPerDeg = distanceMeters(centerLat, centerLng, centerLat + 1, centerLng)
  const northLat = centerLat + 222.4 / metersPerDeg
  const actual = distanceMeters(northLat, centerLng, centerLat, centerLng)
  const roundedRadius = Math.round(actual)
  assert.ok(actual > roundedRadius)
  assert.equal(Math.round(actual), roundedRadius)

  const client = fenceClient([
    { id: 'edge', name: 'On the line', center_lat: centerLat, center_lng: centerLng, radius_m: actual },
    { id: 'rounded', name: 'Rounded inside', center_lat: centerLat, center_lng: centerLng, radius_m: roundedRadius },
    { id: 'nan', name: 'Broken center', center_lat: Number.NaN, center_lng: centerLng, radius_m: 1e12 },
    null,
    { id: 'far', name: 'Equator', center_lat: 0, center_lng: 0, radius_m: 50 },
  ])
  setTestSupabase(client)

  const result = await checkGeofence(northLat, centerLng)
  assert.equal(client.calls.length, 1)
  assert.equal(result.error, null)
  assert.equal(result.inside, true)
  assert.deepEqual(result.matches.map((match) => match.id), ['edge'])
  assert.equal(result.matches[0].name, 'On the line')
  assert.equal(result.matches[0].inside, true)
  assert.equal(result.matches[0].radiusM, actual)
  assert.equal(result.matches[0].distanceM, Math.round(actual))

  const here = await checkGeofence(centerLat, centerLng)
  assert.equal(here.inside, true)
  assert.equal(here.matches.find((match) => match.id === 'edge').distanceM, 0)
  assert.equal(here.matches.find((match) => match.id === 'rounded').distanceM, 0)
  assert.equal(here.matches.some((match) => match.id === 'nan'), false)
  assert.equal(here.matches.some((match) => match.id === 'far'), false)

  // BUG?: a null center latitude is coerced to 0, same as haversineMeters, so the
  // fence is measured from the equator instead of skipped.
  const nullCenter = fenceClient([
    { id: 'null-center', name: 'Null', center_lat: null, center_lng: centerLng, radius_m: 50 },
  ])
  setTestSupabase(nullCenter)
  const missed = await checkGeofence(centerLat, centerLng)
  assert.equal(missed.inside, false)
  assert.deepEqual(missed.matches, [])
  assert.equal(typeof distanceMeters(centerLat, centerLng, null, centerLng), 'number')
})

test('checkGeofence reports query errors and listGeofences reads the same rows', async () => {
  const denied = fenceClient(null, { message: 'permission denied' })
  setTestSupabase(denied)
  const failed = await checkGeofence(34.6836, -82.8364)
  assert.deepEqual(failed, { inside: false, matches: [], error: 'permission denied' })

  const empty = fenceClient(null, null)
  setTestSupabase(empty)
  const none = await checkGeofence(34.6836, -82.8364)
  assert.deepEqual(none, { inside: false, matches: [], error: null })

  setTestSupabase(null)
  assert.deepEqual(await listGeofences(), [])

  const rows = [{ id: 'campus', name: 'Campus', center_lat: 34.68, center_lng: -82.84, radius_m: 400, active: true }]
  setTestSupabase(fenceClient(rows))
  assert.deepEqual(await listGeofences(), rows)

  setTestSupabase(fenceClient(null))
  assert.deepEqual(await listGeofences(), [])
})
