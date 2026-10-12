import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAY_TIERS,
  WORTH_IT_GAUGE_BODY,
  WORTH_IT_LEGEND_LABEL,
  WORTH_IT_LEGEND_TITLE,
  worthItTierForHourlyCents,
} from './worthItGauge.js'

test('worth-it gauge tiers match the Drive page legend', () => {
  assert.equal(WORTH_IT_LEGEND_TITLE, 'Worth-it gauge tiers (per hour)')
  assert.equal(WORTH_IT_LEGEND_LABEL, 'Worth-it gauge tiers, per-hour pay')
  assert.equal(
    WORTH_IT_GAUGE_BODY,
    'Each offer lights up by its hourly rate, from orange through Diamond and Crown. See the tier legend below.',
  )
  assert.deepEqual(PAY_TIERS.map((tier) => [tier.id, tier.label, tier.range, tier.note, tier.color]), [
    ['orange', 'Orange', 'Under $30', 'Base', '#F56600'],
    ['green', 'Green', '$30\u201335', 'Solid', '#22C55E'],
    ['blue', 'Blue', '$35\u201340', 'Strong', '#3B82F6'],
    ['gold', 'Gold', '$40\u201345', 'Great', '#EAB308'],
    ['purple', 'Purple', '$45\u201350', 'Excellent', '#522D80'],
    ['diamond', 'Diamond', '$50\u2013100', 'Escalating effects', '#7DD3FC'],
    ['crown', 'Crown', 'Above $100', 'Top tier', '#FBBF24'],
  ])
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'orange').color, '#F56600')
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'purple').color, '#522D80')
})

test('hourly cents land on the Drive page range edges', () => {
  assert.equal(worthItTierForHourlyCents(null), null)
  assert.equal(worthItTierForHourlyCents(undefined), null)
  assert.equal(worthItTierForHourlyCents(Number.NaN), null)
  assert.equal(worthItTierForHourlyCents(0).id, 'orange')
  assert.equal(worthItTierForHourlyCents(2999).id, 'orange')
  assert.equal(worthItTierForHourlyCents(3000).id, 'green')
  assert.equal(worthItTierForHourlyCents(3499).id, 'green')
  assert.equal(worthItTierForHourlyCents(3500).id, 'blue')
  assert.equal(worthItTierForHourlyCents(3999).id, 'blue')
  assert.equal(worthItTierForHourlyCents(4000).id, 'gold')
  assert.equal(worthItTierForHourlyCents(4499).id, 'gold')
  assert.equal(worthItTierForHourlyCents(4500).id, 'purple')
  assert.equal(worthItTierForHourlyCents(4999).id, 'purple')
  assert.equal(worthItTierForHourlyCents(5000).id, 'diamond')
  assert.equal(worthItTierForHourlyCents(10000).id, 'diamond')
  assert.equal(worthItTierForHourlyCents(10001).id, 'crown')
  assert.equal(worthItTierForHourlyCents(-50).id, 'orange')
})
