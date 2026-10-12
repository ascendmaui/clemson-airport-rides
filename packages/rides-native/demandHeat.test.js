import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateDemand, cellFor, cellRing, decayWeight, describeCell, estimatedDemand,
  fetchDemandCells, heatLayers, normalizeDemandCells, quantize, subscribeDemandCells,
  topDemandZones, tweenCells,
} from './demandHeat.js'

const NOW = Date.parse('2026-10-10T16:00:00Z')
const ago = (m) => new Date(NOW - m * 60000).toISOString()
const COOPER = { lat: 34.67601, lng: -82.83701 }

test('decay halves every half-window and drops past the window', () => {
  assert.equal(decayWeight(0, 20), 1)
  assert.ok(Math.abs(decayWeight(10, 20) - 0.5) < 1e-9)
  assert.ok(Math.abs(decayWeight(20, 20) - 0.25) < 1e-9)
  assert.equal(decayWeight(21, 20), 0)
})

test('aggregation buckets into snapped cells and excludes demo/e2e', () => {
  const cells = aggregateDemand([
    { ...COOPER, at: ago(0) },
    { lat: COOPER.lat + 0.0001, lng: COOPER.lng - 0.0001, at: ago(10) },
    { ...COOPER, at: ago(2), kind: 'pickup' },
    { ...COOPER, at: ago(1), e2e: true },
    { ...COOPER, at: ago(1), demo: true },
    { lat: 34.6835, lng: -82.837, at: ago(1), airport: true },
    { lat: NaN, lng: 1, at: ago(1) },
  ], { now: NOW })
  assert.equal(cells.length, 2)
  const cooper = cells.find((c) => c.cell_id === cellFor(COOPER.lat, COOPER.lng).id)
  assert.equal(cooper.requests, 2)
  assert.equal(cooper.pickups, 1)
  assert.ok(Math.abs(cooper.demand - (1 + 0.5 + 0.6 * decayWeight(2))) < 1e-9)
  const air = cells.find((c) => c.airport === 1)
  assert.ok(air.demand > 1.3)
  assert.notEqual(cooper.lat, COOPER.lat)
})

test('normalization scores relative to hottest cell with an absolute floor', () => {
  const lonely = normalizeDemandCells([{ cell_id: 'a', lat: 1, lng: 2, demand: 1, requests: 1 }])
  assert.ok(lonely[0].intensity <= 0.5, 'one request should not paint max heat')
  const busy = normalizeDemandCells([
    { cell_id: 'a', lat: 1, lng: 2, demand: '9', requests: 6 },
    { cell_id: 'b', lat: 1, lng: 2, demand: 2.25, requests: 2 },
    { cell_id: 'bad', lat: null, lng: 2, demand: 3 },
    { cell_id: 'zero', lat: 1, lng: 2, demand: 0 },
  ])
  assert.deepEqual(busy.map((c) => c.id), ['a', 'b'])
  assert.equal(busy[0].intensity, 1)
  assert.equal(busy[1].intensity, 0.5)
  assert.equal(normalizeDemandCells(null).length, 0)
  assert.equal(normalizeDemandCells(Array.from({ length: 80 }, (_, i) => ({ cell_id: `c${i}`, lat: 1, lng: 1, demand: 1 }))).length, 30)
})

test('tap description reports estimate and distance, never identities', () => {
  const [cell] = normalizeDemandCells([{ cell_id: 'g1', lat: 34.6763, lng: -82.8375, demand: 4, requests: 3, pickups: 1, airport: 1 }])
  const info = describeCell(cell, { lat: 34.6839, lng: -82.8366 })
  assert.equal(info.title, 'Very busy')
  assert.match(info.estimate, /^3–5 rides/)
  assert.match(info.detail, /3 asking now · 1 recent pickup · airport demand/)
  assert.match(info.distance, /^0\.5 mi away$/)
  assert.equal(describeCell(cell, null).distance, null)
  assert.deepEqual(estimatedDemand({ demand: 0.3, requests: 1 }), { low: 1, high: 1, label: '~1' })
})

test('heat layers stay translucent and are stronger on dark maps', () => {
  const light = heatLayers(1, 'light')
  const dark = heatLayers(1, 'dark')
  const alpha = (s) => Number(s.match(/,([\d.]+)\)$/)[1])
  assert.ok(alpha(light.core) > alpha(light.halo))
  assert.ok(alpha(dark.core) > alpha(light.core))
  assert.ok(alpha(dark.core) <= 0.85)
  assert.notEqual(heatLayers(0, 'light').core, light.core)
})

test('tween fades cells in and out; quantize limits re-renders', () => {
  const a = [{ id: 'x', intensity: 1 }, { id: 'gone', intensity: 0.6 }]
  const b = [{ id: 'x', intensity: 0.5 }, { id: 'new', intensity: 0.8 }]
  const mid = tweenCells(a, b, 0.5)
  assert.equal(mid.find((c) => c.id === 'x').intensity, 0.75)
  assert.equal(mid.find((c) => c.id === 'new').intensity, 0.4)
  assert.equal(mid.find((c) => c.id === 'gone').fading, true)
  assert.equal(tweenCells(a, b, 1).some((c) => c.id === 'gone'), false)
  assert.equal(quantize(0.51), 0.5)
  assert.equal(cellRing({ lat: 1, lng: 1 }).length, 12)
  assert.deepEqual(topDemandZones(b, { minIntensity: 0.6 }).map((c) => c.id), ['new'])
})

test('fetch calls the RPC with peak params and handles errors', async () => {
  const calls = []
  const sb = { rpc: async (name, args) => { calls.push([name, args]); return { data: [{ cell_id: 'a', lat: 1, lng: 1, demand: 2 }], error: null } } }
  const ok = await fetchDemandCells(sb, { peak: true })
  assert.deepEqual(calls[0], ['driver_demand_cells', { p_window_minutes: 30, p_peak: true }])
  assert.equal(ok.cells.length, 1)
  const bad = await fetchDemandCells({ rpc: async () => ({ data: null, error: { message: 'denied' } }) })
  assert.deepEqual([bad.cells, bad.error], [[], 'denied'])
  assert.equal((await fetchDemandCells(null)).error, 'no-client')
})

test('subscription polls, nudges on realtime, pauses in background, cleans up', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let rpcCount = 0
  let handler = null
  let removed = false
  let appListener = null
  const sb = {
    rpc: async () => { rpcCount += 1; return { data: [], error: null } },
    channel: () => ({ on(_e, _f, cb) { handler = cb; return this }, subscribe() { return this } }),
    removeChannel: () => { removed = true },
  }
  const appState = { addEventListener: (_e, cb) => { appListener = cb; return { remove() {} } } }
  const results = []
  const stop = subscribeDemandCells(sb, { onData: (r) => results.push(r), appState })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(rpcCount, 1)
  t.mock.timers.tick(30_000); await Promise.resolve(); await Promise.resolve()
  assert.equal(rpcCount, 2)
  handler(); handler()
  t.mock.timers.tick(4_000); await Promise.resolve(); await Promise.resolve()
  assert.equal(rpcCount, 3)
  appListener('background')
  t.mock.timers.tick(30_000); await Promise.resolve()
  assert.equal(rpcCount, 3)
  appListener('active'); await Promise.resolve(); await Promise.resolve()
  assert.equal(rpcCount, 4)
  stop()
  assert.equal(removed, true)
  assert.ok(results.length >= 3)
})
