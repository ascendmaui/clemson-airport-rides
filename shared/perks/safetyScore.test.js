import assert from 'node:assert/strict'
import test from 'node:test'
import { gpsSignals, safetyDispatchBoost, safetyScore } from './safetyScore.js'

const series = (trip, speeds, start = Date.parse('2026-10-10T20:00:00Z'), step = 2) =>
  speeds.map((v, i) => ({ trip_id: trip, speed_mps: v, recorded_at: new Date(start + i * step * 1000).toISOString() }))

test('hard braking = speed drop >= 3.4 m/s^2 between close samples; gaps ignored', () => {
  const smooth = series('a', Array.from({ length: 30 }, () => 15))
  const brake = series('b', [...Array(25).fill(20), 10, 10, 10]) // -10 m/s over 2 s
  const g = gpsSignals([...smooth, ...brake], {})
  assert.equal(g.hardBrakes, 1)
  assert.ok(g.hasGps)
  const gap = gpsSignals(series('c', [20, 0], Date.now(), 30), {})
  assert.equal(gap.hardBrakes, 0)
})

test('speeding share uses the configured limit', () => {
  const g = gpsSignals(series('a', [...Array(15).fill(20), ...Array(5).fill(35)]), { speedingMps: 31.3 })
  assert.equal(g.speedingShare, 0.25)
})

test('score is labeled an estimate, clamps 0-100, and orders tips by impact', () => {
  const clean = safetyScore({ gps: { hasGps: true, hardBrakes: 0, hardBrakesPerHour: 0, speedingShare: 0 }, counts: { ratings: 10, lowRatings: 0, accepted: 10, driverCancels: 0, sos: 0 } }, {})
  assert.equal(clean.score, 100)
  assert.equal(clean.estimate, true)
  assert.equal(clean.label, 'Estimate')
  const rough = safetyScore({ gps: { hasGps: true, hardBrakes: 9, hardBrakesPerHour: 9, speedingShare: 0.1 }, counts: { ratings: 10, lowRatings: 1, accepted: 10, driverCancels: 2, sos: 1 } }, {})
  assert.equal(rough.score, Math.round(100 - 25 - 10 - 5 - 6 - 10))
  assert.match(rough.tips[0], /following distance/)
  const noGps = safetyScore({ gps: null, counts: {} }, {})
  assert.equal(noGps.hasGps, false)
  assert.ok(noGps.tips.some((t) => /location on/.test(t)))
})

test('dispatch is unaffected unless configured', () => {
  const low = { score: 50 }
  assert.equal(safetyDispatchBoost(low, {}), 0)
  assert.equal(safetyDispatchBoost(low, { affectsDispatch: true }), -1)
  assert.equal(safetyDispatchBoost({ score: 90 }, { affectsDispatch: true }), 0)
})

test('trigger migration never blocks location writes', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(new URL('../../supabase/migrations/20261012190000_driver_safety_score.sql', import.meta.url), 'utf8')
  assert.match(sql, /exception when others then\s+return new/i)
  assert.match(sql, /'affectsDispatch', false/)
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate)\b/i)
})
