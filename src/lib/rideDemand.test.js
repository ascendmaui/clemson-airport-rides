import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { typicalDemandPoints } from './downtownHeat.js'
import { registerLibImports } from '../../tests/fixtures/register-lib-imports.js'
import { setTestSupabase } from '../../tests/fixtures/supabase-stub.js'

// rideDemand.js imports `./supabase` and `./downtownHeat` without extensions.
await registerLibImports()

const {
  HEAT_GRADIENT,
  HEAT_WINDOWS,
  MAP_TYPES,
  fetchRideDemand,
  fetchSurgeIntensity,
  loadMapType,
  resolveDemandRange,
  saveMapType,
  surgeIntensityFromPoints,
  toWeightedLocations,
} = await import('./rideDemand.js')

const DAY_MS = 864e5
const HOUR_MS = 36e5

afterEach(() => {
  setTestSupabase(null)
})

test('heat windows, map types, and gradient are the campus map palette', () => {
  assert.deepEqual(HEAT_GRADIENT, [
    'rgba(82,45,128,0)',
    '#522D80',
    '#7A4CA8',
    '#C45A12',
    '#F56600',
  ])
  assert.deepEqual(HEAT_WINDOWS, [
    { id: 'now', label: 'Now' },
    { id: 'weekday_am', label: 'Weekday morning' },
    { id: 'friday_night', label: 'Friday night' },
    { id: 'last_7d', label: 'Last 7 days' },
  ])
  assert.deepEqual(MAP_TYPES, [
    { id: 'roadmap', label: 'Roadmap' },
    { id: 'satellite', label: 'Satellite' },
    { id: 'hybrid', label: 'Hybrid' },
  ])
})

test('resolveDemandRange uses surge lookbacks and busy lookbacks', () => {
  const cases = [
    ['surge', 'weekday_am', 7 * DAY_MS, 7, 10],
    ['surge', 'friday_night', 14 * DAY_MS, 21, 23],
    ['surge', 'last_7d', 7 * DAY_MS, null, null],
    ['surge', 'now', 2 * HOUR_MS, null, null],
    ['surge', 'nope', 2 * HOUR_MS, null, null],
    ['surge', undefined, 2 * HOUR_MS, null, null],
    ['busy', 'weekday_am', 30 * DAY_MS, 7, 10],
    ['busy', 'friday_night', 30 * DAY_MS, 21, 23],
    ['busy', 'last_7d', 7 * DAY_MS, null, null],
    ['busy', 'now', 14 * DAY_MS, null, null],
    ['busy', 'nope', 14 * DAY_MS, null, null],
    ['busy', undefined, 14 * DAY_MS, null, null],
    ['other', 'now', 14 * DAY_MS, null, null],
    ['other', 'weekday_am', 30 * DAY_MS, 7, 10],
    [undefined, 'friday_night', 30 * DAY_MS, 21, 23],
    [undefined, undefined, 14 * DAY_MS, null, null],
  ]

  for (const [mode, windowId, span, hourStart, hourEnd] of cases) {
    const range = resolveDemandRange(mode, windowId)
    const name = `${String(mode)}/${String(windowId)}`
    assert.deepEqual(Object.keys(range).sort(), ['from', 'hourEnd', 'hourStart', 'to'], name)
    assert.ok(range.from instanceof Date, name)
    assert.ok(range.to instanceof Date, name)
    assert.equal(range.from.getTime(), range.to.getTime() - span, name)
    assert.equal(range.hourStart, hourStart, name)
    assert.equal(range.hourEnd, hourEnd, name)
    assert.ok(Math.abs(range.to.getTime() - Date.now()) < 2000, name)
  }

  const defaults = resolveDemandRange()
  assert.equal(defaults.from.getTime(), defaults.to.getTime() - 14 * DAY_MS)
  assert.equal(defaults.hourStart, null)
  assert.equal(defaults.hourEnd, null)
})

test('resolveDemandRange returns fresh dates the caller can mutate', () => {
  const first = resolveDemandRange('busy', 'last_7d')
  const second = resolveDemandRange('surge', 'weekday_am')
  assert.notEqual(first.from, second.from)
  assert.notEqual(first.to, second.to)
  first.from.setTime(0)
  first.to.setTime(0)
  assert.equal(second.from.getTime(), second.to.getTime() - 7 * DAY_MS)
  assert.equal(second.hourStart, 7)
  assert.equal(second.hourEnd, 10)
  assert.notEqual(second.to.getTime(), 0)
})

function installStorage() {
  const session = new Map()
  const local = new Map()
  const previousSession = globalThis.sessionStorage
  const previousLocal = globalThis.localStorage
  globalThis.sessionStorage = {
    getItem(key) {
      return session.has(String(key)) ? session.get(String(key)) : null
    },
    setItem(key, value) {
      session.set(String(key), String(value))
    },
    removeItem(key) {
      session.delete(String(key))
    },
    clear() {
      session.clear()
    },
  }
  globalThis.localStorage = {
    getItem(key) {
      return local.has(String(key)) ? local.get(String(key)) : null
    },
    setItem(key, value) {
      local.set(String(key), String(value))
    },
    removeItem(key) {
      local.delete(String(key))
    },
    clear() {
      local.clear()
    },
  }
  return {
    session,
    local,
    restore() {
      if (previousSession === undefined) delete globalThis.sessionStorage
      else globalThis.sessionStorage = previousSession
      if (previousLocal === undefined) delete globalThis.localStorage
      else globalThis.localStorage = previousLocal
    },
  }
}

test('loadMapType and saveMapType round-trip roadmap, satellite, and hybrid in sessionStorage', () => {
  const storage = installStorage()
  try {
    storage.local.set('clemson-map-type', 'satellite')
    assert.equal(loadMapType(), 'roadmap')
    assert.equal(storage.session.size, 0)

    for (const id of ['satellite', 'hybrid', 'roadmap']) {
      saveMapType(id)
      assert.equal(storage.session.get('clemson-map-type'), id)
      assert.equal(loadMapType(), id)
      assert.equal(storage.local.size, 1)
    }

    storage.session.set('clemson-map-type', ' satellite')
    assert.equal(loadMapType(), 'roadmap')
    storage.session.set('clemson-map-type', 'terrain')
    assert.equal(loadMapType(), 'roadmap')
    storage.session.set('clemson-map-type', '')
    assert.equal(loadMapType(), 'roadmap')

    saveMapType('satellite')
    saveMapType('terrain')
    // BUG?: an invalid id is stored, so the next load ignores the previous satellite choice.
    assert.equal(storage.session.get('clemson-map-type'), 'terrain')
    assert.equal(loadMapType(), 'roadmap')

    saveMapType(null)
    assert.equal(storage.session.get('clemson-map-type'), 'null')
    assert.equal(loadMapType(), 'roadmap')
  } finally {
    storage.restore()
  }
})

test('loadMapType and saveMapType ignore a missing or throwing sessionStorage', () => {
  const previous = globalThis.sessionStorage
  delete globalThis.sessionStorage
  try {
    assert.equal(loadMapType(), 'roadmap')
    assert.doesNotThrow(() => saveMapType('hybrid'))
    assert.equal(loadMapType(), 'roadmap')

    globalThis.sessionStorage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    }
    assert.equal(loadMapType(), 'roadmap')
    assert.doesNotThrow(() => saveMapType('satellite'))
    assert.equal(loadMapType(), 'roadmap')
  } finally {
    if (previous === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = previous
  }
})

test('toWeightedLocations builds heatmap weights only when Google Maps is loaded', () => {
  const previous = globalThis.window
  try {
    delete globalThis.window
    assert.deepEqual(toWeightedLocations([{ lat: 34.68, lng: -82.84, weight: 4 }]), [])
    assert.deepEqual(toWeightedLocations(null), [])
    assert.deepEqual(toWeightedLocations(undefined), [])

    globalThis.window = {}
    assert.deepEqual(toWeightedLocations([{ lat: 34.68, lng: -82.84 }]), [])
    globalThis.window = { google: {} }
    assert.deepEqual(toWeightedLocations([{ lat: 34.68, lng: -82.84 }]), [])

    const created = []
    class LatLng {
      constructor(lat, lng) {
        this.lat = lat
        this.lng = lng
        created.push(this)
      }
    }
    globalThis.window = { google: { maps: { LatLng } } }

    const rows = toWeightedLocations([
      { lat: 34.68, lng: -82.84, weight: 4 },
      { lat: Number.NaN, lng: -82.84, weight: 9 },
      { lat: 34.7, lng: Number.POSITIVE_INFINITY, weight: 9 },
      // BUG?: numeric strings are dropped. Number.isFinite does not coerce them.
      { lat: '34.71', lng: '-82.81', weight: 2.5 },
      { lat: 34.72, lng: -82.82, weight: '2.5' },
      { lat: 34.73, lng: -82.83, weight: 0 },
      { lat: 34.74, lng: -82.85 },
      { lat: 34.75, lng: -82.86, weight: Number.NaN },
      { lat: 34.76, lng: -82.87, weight: -3 },
      { lat: 34.77, lng: -82.88, weight: 0.05 },
    ])

    assert.deepEqual(rows.map((row) => row.location), created)
    assert.deepEqual(rows.map((row) => [row.location.lat, row.location.lng, row.weight]), [
      [34.68, -82.84, 4],
      [34.72, -82.82, 2.5],
      [34.73, -82.83, 1],
      [34.74, -82.85, 1],
      [34.75, -82.86, 1],
      [34.76, -82.87, 0.1],
      [34.77, -82.88, 0.1],
    ])
    // BUG?: weight 0 is falsy, so it becomes 1 instead of the 0.1 floor used for tiny weights.
    assert.equal(rows.find((row) => row.location.lat === 34.73).weight, 1)

    assert.deepEqual(toWeightedLocations([]), [])
    assert.deepEqual(toWeightedLocations(null), [])

    // BUG?: a null entry throws before the finite-coordinate filter.
    assert.throws(() => toWeightedLocations([{ lat: 34.68, lng: -82.84 }, null]), TypeError)
    // BUG?: a bare point object is not wrapped into a one-element list.
    assert.throws(() => toWeightedLocations({ lat: 34.68, lng: -82.84, weight: 2 }), TypeError)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})

test('surgeIntensityFromPoints clamps the heaviest weight onto 0–1', () => {
  assert.equal(surgeIntensityFromPoints([]), 0)
  assert.equal(surgeIntensityFromPoints(null), 0)
  assert.equal(surgeIntensityFromPoints(undefined), 0)
  assert.equal(surgeIntensityFromPoints([{ weight: 0 }, { weight: -4 }]), 0)
  assert.equal(surgeIntensityFromPoints([{ weight: 4 }]), 0.5)
  assert.equal(surgeIntensityFromPoints([{ weight: '4' }, { weight: 1 }]), 0.5)
  assert.equal(surgeIntensityFromPoints([{ weight: 8 }]), 1)
  assert.equal(surgeIntensityFromPoints([{ weight: 16 }, { weight: 0.2 }]), 1)
  assert.equal(surgeIntensityFromPoints([{}]), 0)
  assert.equal(surgeIntensityFromPoints([{ weight: Number.NaN }]), 0)

  // BUG?: a null entry throws instead of being skipped.
  assert.throws(() => surgeIntensityFromPoints([null]), TypeError)
  // BUG?: a string has length, so the empty check passes and then .map throws.
  assert.throws(() => surgeIntensityFromPoints('abc'), TypeError)
})

function scaledTypical(scale, when = new Date()) {
  return typicalDemandPoints(when, { includeCampus: true }).map((point) => ({
    ...point,
    weight: point.weight * scale,
  }))
}

function assertSameHourBlend(points, scale) {
  const start = new Date()
  const expected = scaledTypical(scale, start)
  const end = new Date()
  if (start.getHours() !== end.getHours() || start.getDay() !== end.getDay()) return
  assert.deepEqual(points.slice(points.length - expected.length), expected)
}

test('fetchRideDemand blends typical points when Supabase is not configured', async () => {
  const busy = await fetchRideDemand()
  assert.equal(busy.mode, 'busy')
  assert.equal(busy.windowId, 'now')
  assert.equal(busy.liveCount, 0)
  assert.equal(busy.blended, true)
  assert.equal(busy.error, 'Supabase not configured')
  assert.equal(busy.label, 'Busy Areas')
  assert.match(busy.caption, /^Live \+ typical — College Ave feels (quiet|picking up|busy|packed) for this hour$/)
  assert.equal(busy.points.length, typicalDemandPoints().length)
  assert.ok(busy.points.every((point) => point.source === 'typical' && Number.isFinite(point.lat) && Number.isFinite(point.lng)))
  assertSameHourBlend(busy.points, 0.85)

  const surge = await fetchRideDemand({ mode: 'surge', windowId: 'friday_night' })
  assert.equal(surge.mode, 'surge')
  assert.equal(surge.windowId, 'friday_night')
  assert.equal(surge.liveCount, 0)
  assert.equal(surge.blended, true)
  assert.equal(surge.label, 'Surge Zones')
  assert.equal(surge.error, 'Supabase not configured')
  assert.equal(surge.caption, 'Live + typical — position near hotter zones for better ride chances')
  assertSameHourBlend(surge.points, 0.45)

  const intensity = await fetchSurgeIntensity('last_7d')
  assert.equal(intensity.blended, true)
  assert.equal(intensity.liveCount, 0)
  assert.equal(intensity.label, 'Surge Zones')
  assert.equal(intensity.error, 'Supabase not configured')
  assert.ok(intensity.intensity > 0 && intensity.intensity <= 1)
  const start = new Date()
  const fromTypical = surgeIntensityFromPoints(scaledTypical(0.45, start))
  const end = new Date()
  if (start.getHours() === end.getHours() && start.getDay() === end.getDay()) {
    assert.equal(intensity.intensity, fromTypical)
  }
})

function rpcClient(result) {
  const calls = []
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args })
      return Promise.resolve(result)
    },
  }
}

function liveRows(count, weight = 1) {
  return Array.from({ length: count }, (_, index) => ({
    lat: 34.68 + index * 0.001,
    lng: -82.84,
    weight,
    request_count: 2,
  }))
}

test('fetchRideDemand maps live rows and blends typical points by volume', async () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => {
    warnings.push(args)
  }
  try {
    const highBusy = rpcClient({ data: liveRows(8, 1), error: null })
    setTestSupabase(highBusy)
    const busy = await fetchRideDemand({ mode: 'busy', windowId: 'weekday_am' })
    assert.equal(highBusy.calls.length, 1)
    assert.equal(highBusy.calls[0].name, 'get_ride_demand')
    assert.equal(highBusy.calls[0].args.p_hour_start, 7)
    assert.equal(highBusy.calls[0].args.p_hour_end, 10)
    assert.equal(
      new Date(highBusy.calls[0].args.p_to) - new Date(highBusy.calls[0].args.p_from),
      30 * DAY_MS,
    )
    assert.equal(busy.error, null)
    assert.equal(busy.liveCount, 8)
    assert.equal(busy.blended, true)
    assert.equal(busy.label, 'Busy Areas')
    assert.match(busy.caption, /^Live \+ typical — College Ave feels /)
    assert.equal(busy.points[0].source, 'live')
    assert.equal(busy.points[0].weight, 1)
    assert.equal(busy.points[0].requestCount, 2)
    assert.equal(busy.points.filter((point) => point.source === 'live').length, 8)
    assertSameHourBlend(busy.points, 0.35)

    const highSurge = rpcClient({ data: liveRows(8, 2), error: null })
    setTestSupabase(highSurge)
    const surge = await fetchRideDemand({ mode: 'surge', windowId: 'now' })
    assert.equal(highSurge.calls[0].args.p_hour_start, null)
    assert.equal(highSurge.calls[0].args.p_hour_end, null)
    assert.equal(
      new Date(highSurge.calls[0].args.p_to) - new Date(highSurge.calls[0].args.p_from),
      2 * HOUR_MS,
    )
    assert.equal(surge.blended, false)
    assert.equal(surge.liveCount, 8)
    assert.equal(surge.label, 'Surge Zones')
    assert.equal(surge.caption, 'Live request density — hotter zones often mean more trip opportunities')
    assert.deepEqual(
      surge.points.map((point) => point.weight),
      Array.from({ length: 8 }, () => 2 * 1.35),
    )
    assert.ok(surge.points.every((point) => point.source === 'live'))

    const thin = rpcClient({
      data: [
        { lat: '34.70', lng: '-82.80', weight: '3', request_count: '4' },
        { lat: 34.71, lng: -82.81, weight: 0.01, request_count: 9 },
        { lat: 34.72, lng: -82.82, weight: 0, request_count: 4 },
        { lat: 'nope', lng: -82.83, weight: 5, request_count: 1 },
        { lat: 34.73, lng: Number.NaN, weight: 5, request_count: 1 },
        { lat: null, lng: -82.84, weight: 5, request_count: 1 },
      ],
      error: null,
    })
    setTestSupabase(thin)
    const low = await fetchRideDemand({ mode: 'surge', windowId: 'last_7d' })
    assert.equal(thin.calls[0].args.p_hour_start, null)
    assert.equal(thin.calls[0].args.p_hour_end, null)
    assert.equal(new Date(thin.calls[0].args.p_to) - new Date(thin.calls[0].args.p_from), 7 * DAY_MS)
    assert.equal(low.blended, true)
    assert.equal(low.caption, 'Live + typical — position near hotter zones for better ride chances')
    const live = low.points.filter((point) => point.source === 'live')
    assert.deepEqual(live.map((point) => [point.lat, point.lng, point.weight, point.requestCount]), [
      [34.7, -82.8, 3 * 1.35, 4],
      [34.71, -82.81, 0.2 * 1.35, 9],
      [34.72, -82.82, 4 * 1.35, 4],
      // BUG?: Number(null) is 0, which is finite, so a null latitude is kept at the equator.
      [0, -82.84, 5 * 1.35, 1],
    ])
    assertSameHourBlend(low.points, 0.45)

    const weightBoundary = rpcClient({ data: liveRows(8, 0.5), error: null })
    setTestSupabase(weightBoundary)
    const stillLow = await fetchRideDemand({ mode: 'busy', windowId: 'now' })
    assert.equal(stillLow.liveCount, 8)
    assert.equal(stillLow.blended, true)
    assertSameHourBlend(stillLow.points, 0.85)

    const unknown = rpcClient({ data: liveRows(8, 1), error: null })
    setTestSupabase(unknown)
    const other = await fetchRideDemand({ mode: 'other', windowId: 'now' })
    assert.equal(other.blended, false)
    assert.equal(other.label, 'Busy Areas')
    assert.equal(other.caption, 'Live ride-request density across campus')
    assert.equal(other.points.length, 8)
    assert.ok(other.points.every((point) => point.weight === 1 && point.source === 'live'))

    warnings.length = 0
    const broken = rpcClient({ data: liveRows(8, 9), error: { message: 'rpc down' } })
    setTestSupabase(broken)
    const fallback = await fetchRideDemand({ mode: 'busy', windowId: 'last_7d' })
    assert.equal(fallback.error, 'rpc down')
    assert.equal(fallback.liveCount, 0)
    assert.equal(fallback.blended, true)
    assert.deepEqual(warnings, [['[rideDemand]', 'rpc down']])
    assertSameHourBlend(fallback.points, 0.85)

    const empty = rpcClient({ data: null, error: null })
    setTestSupabase(empty)
    const none = await fetchRideDemand({ mode: 'busy', windowId: 'now' })
    assert.equal(none.liveCount, 0)
    assert.equal(none.error, null)
    assert.equal(none.blended, true)
    assertSameHourBlend(none.points, 0.85)
  } finally {
    console.warn = originalWarn
  }
})

test('fetchSurgeIntensity reads the surge demand window', async () => {
  setTestSupabase(rpcClient({ data: liveRows(8, 8), error: null }))
  const hot = await fetchSurgeIntensity('weekday_am')
  assert.equal(hot.intensity, 1)
  assert.equal(hot.blended, false)
  assert.equal(hot.liveCount, 8)
  assert.equal(hot.label, 'Surge Zones')
  assert.equal(hot.error, null)

  setTestSupabase(rpcClient({ data: [{ lat: 34.68, lng: -82.84, weight: 4, request_count: 1 }], error: null }))
  const mild = await fetchSurgeIntensity('now')
  assert.equal(mild.blended, true)
  assert.equal(mild.liveCount, 1)
  // Live weight 4 * 1.35 is heavier than any typical point (max 4, scaled by 0.45).
  assert.equal(mild.intensity, (4 * 1.35) / 8)
})
