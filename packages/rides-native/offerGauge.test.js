import test from 'node:test'
import assert from 'node:assert/strict'
import { diamondLevel, gaugeEffects, effectiveHourly, formatGauge, gaugeTier, offerGauge, gaugeFill } from './offerGauge.js'

test('tier boundaries', () => {
  const cases = [
    [29.99, 'orange'], [30, 'green'], [34.99, 'green'], [35, 'blue'], [40, 'gold'],
    [45, 'purple'], [45.01, 'purple'], [49.99, 'purple'], [50, 'diamond'], [50.01, 'diamond'],
    [99.99, 'diamond'], [100, 'diamond'], [100.01, 'crown'],
  ]
  for (const [v, tier] of cases) assert.equal(gaugeTier(v), tier, String(v))
  assert.equal(gaugeTier(NaN), null)
})

test('formula: net / (pickup + trip minutes), tips only when prepaid', () => {
  // $19 net over 10 + 20 min = $38/hr
  assert.equal(effectiveHourly({ netCents: 1900, pickupMinutes: 10, tripMinutes: 20 }), 38)
  assert.equal(effectiveHourly({ netCents: 1900, tipCents: 500, pickupMinutes: 10, tripMinutes: 20 }), 38)
  assert.equal(effectiveHourly({ netCents: 1900, tipCents: 500, tipPrepaid: true, pickupMinutes: 10, tripMinutes: 20 }), 48)
  assert.equal(effectiveHourly({ netCents: 1900, pickupMinutes: 0, tripMinutes: 0 }), null)
})

test('format and view model', () => {
  assert.equal(formatGauge(38.4), '$38/hr')
  assert.equal(formatGauge(null), '—/hr')
  const g = offerGauge({ netCents: 1900, pickupMinutes: 10, tripMinutes: 20 })
  assert.equal(g.text, '$38/hr')
  assert.equal(g.tier, 'blue')
  assert.equal(gaugeFill(120), 1)
})

test('diamond sub-levels', () => {
  const cases = [[49.99, null], [50, 1], [59.99, 1], [60, 2], [70, 3], [80, 4], [89.99, 4], [90, 5], [100, 5], [100.01, null]]
  for (const [v, l] of cases) assert.equal(diamondLevel(v), l, String(v))
})

test('diamond intensity ramps monotonically, crown on top', () => {
  const fx = [1, 2, 3, 4, 5].map((l) => gaugeEffects('diamond', l))
  for (let i = 1; i < fx.length; i++) {
    assert.ok(fx[i].shimmerMs < fx[i - 1].shimmerMs)
    assert.ok(fx[i].glow >= fx[i - 1].glow)
    assert.ok(fx[i].sparkles >= fx[i - 1].sparkles)
  }
  assert.equal(fx[4].haptics, 2)
  assert.equal(fx[3].ring, true)
  assert.equal(gaugeEffects('crown').haptics, 1)
  assert.equal(gaugeEffects('green').shimmerMs, 0)
})
