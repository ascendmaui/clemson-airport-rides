import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildForecast, classifyZone, eventEffect, heuristicCentsPerHour, historyBuckets, localParts, tripZone, LOW_DATA_TRIPS,
} from './earningsForecast.js'

const GAME = { kind: 'football_home', title: 'Football vs. Charleston Southern', event_date: '2026-10-17', starts_at: '2026-10-17T16:00:00Z', demand_weight: 2, active: true }
// Mon Oct 12 2026 07:00 EDT
const NOW = Date.parse('2026-10-12T11:00:00Z')

test('classifies zones by label and coordinates', () => {
  assert.equal(classifyZone({ label: 'GSP International Airport' }), 'gsp')
  assert.equal(classifyZone({ label: 'Charlotte Douglas (CLT)' }), 'clt')
  assert.equal(classifyZone({ label: 'Hartsfield-Jackson ATL' }), 'atl')
  assert.equal(classifyZone({ lat: 34.6788, lng: -82.843 }), 'stadium')
  assert.equal(classifyZone({ lat: 34.6836, lng: -82.8364 }), 'downtown')
  assert.equal(classifyZone({ lat: 34.6740, lng: -82.8330 }), 'campus')
  assert.equal(classifyZone({ lat: 36, lng: -80 }), null)
  assert.equal(tripZone({ pickup_lat: 34.6784, pickup_lng: -82.8397, dropoff_label: 'GSP' }), 'gsp')
})

test('localParts uses Clemson time regardless of process TZ', () => {
  assert.deepEqual(localParts('2026-10-17T16:00:00Z'), { dow: 6, hour: 12, date: '2026-10-17' })
})

test('heuristics: Friday afternoon airport beats weekday morning downtown', () => {
  assert.ok(heuristicCentsPerHour('gsp', 5, 14) > heuristicCentsPerHour('downtown', 2, 10))
  assert.ok(heuristicCentsPerHour('downtown', 6, 22) > heuristicCentsPerHour('downtown', 2, 22))
})

test('home game boosts stadium near kickoff, airports the day before', () => {
  const kickoff = eventEffect('stadium', Date.parse('2026-10-17T16:00:00Z'), [GAME])
  assert.ok(kickoff.bonusCents > 0)
  assert.match(kickoff.reasons[0], /Charleston Southern/)
  const quiet = eventEffect('stadium', Date.parse('2026-10-14T16:00:00Z'), [GAME])
  assert.equal(quiet.bonusCents, 0)
  const fri = eventEffect('gsp', Date.parse('2026-10-16T18:00:00Z'), [GAME])
  assert.ok(fri.multiplier > 1)
  const inactive = eventEffect('stadium', Date.parse('2026-10-17T16:00:00Z'), [{ ...GAME, active: false }])
  assert.equal(inactive.bonusCents, 0)
})

test('low data: ranks by heuristics + events, flags estimate, game-day stadium surfaces', () => {
  const f = buildForecast({ trips: [], events: [GAME], now: NOW, limit: 5 })
  assert.equal(f.lowData, true)
  assert.match(f.disclaimer, /Estimate/)
  assert.equal(f.slotCount, 7 * 12 * 6)
  for (let i = 1; i < f.top.length; i++) assert.ok(f.top[i - 1].expectedCentsPerHour >= f.top[i].expectedCentsPerHour)
  assert.equal(f.top[0].localDate, '2026-10-17')
  assert.equal(f.top[0].zone, 'stadium')
  assert.ok(f.top.some((s) => s.zone === 'stadium' && s.localDate === '2026-10-17'))
  assert.ok(f.bestByDay.length >= 7)
  assert.ok(f.top.every((s) => s.confidence === 'low'))
})

test('history shifts the ranking toward zones that actually paid', () => {
  // 30 lucrative Tuesday 10am campus trips
  const trips = Array.from({ length: 30 }, (_, i) => ({
    completed_at: `2026-09-${String(1 + (i % 4) * 7).padStart(2, '0')}T14:30:00Z`,
    pickup_lat: 34.674, pickup_lng: -82.833, dropoff_lat: 34.674, dropoff_lng: -82.833,
    driver_earnings_cents: 4000, route_duration_s: 900,
  }))
  const { used } = historyBuckets(trips)
  assert.equal(used, 30)
  assert.ok(used >= LOW_DATA_TRIPS)
  const f = buildForecast({ trips, events: [], now: NOW, limit: 3 })
  assert.equal(f.lowData, false)
  assert.equal(f.top[0].zone, 'campus')
  assert.equal(localParts(f.top[0].startsAt).hour, 10)
  assert.equal(f.top[0].confidence, 'high')
})

test('ignores trips with no zone or no money', () => {
  const { used } = historyBuckets([{ completed_at: '2026-09-01T00:00:00Z', pickup_lat: 40, pickup_lng: -70, driver_earnings_cents: 900 }, { completed_at: '2026-09-01T00:00:00Z', pickup_label: 'GSP' }])
  assert.equal(used, 0)
})

test('forecast endpoint: auth required, returns ranked estimate', async () => {
  const { default: handler } = await import('../../server/endpoints/earningsForecast.js')
  const mk = () => ({ statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } })
  const noAuth = mk()
  await handler({ method: 'GET', headers: {} }, noAuth, { sb: {}, user: null })
  assert.equal(noAuth.statusCode, 401)
  const res = mk()
  await handler({ method: 'GET', headers: {} }, res, { sb: {}, user: { id: 'u' }, now: NOW, loadInputs: async () => ({ trips: [], events: [GAME] }) })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.lowData, true)
  assert.equal(body.top[0].zone, 'stadium')
  assert.equal(body.events[0].title, GAME.title)
})
