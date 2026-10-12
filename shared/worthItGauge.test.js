import assert from 'node:assert/strict'
import test from 'node:test'
import { GAUGE_PALETTE, GAUGE_TIERS, gaugeTier } from '../packages/rides-native/offerGauge.js'
import {
  PAY_TIERS,
  WORTH_IT_GAUGE_BODY,
  WORTH_IT_LEGEND_LABEL,
  WORTH_IT_LEGEND_TITLE,
  worthItTierForHourlyCents,
} from './worthItGauge.js'

test('worth-it legend matches the offer gauge', () => {
  assert.equal(WORTH_IT_LEGEND_TITLE, 'Worth-it gauge tiers (per hour)')
  assert.equal(WORTH_IT_LEGEND_LABEL, 'Worth-it gauge tiers, per-hour pay')
  assert.equal(
    WORTH_IT_GAUGE_BODY,
    'Each offer lights up by its hourly rate, from orange through Diamond and Crown. See the tier legend below.',
  )
  assert.deepEqual(PAY_TIERS.map((tier) => tier.id), GAUGE_TIERS.map((tier) => tier.id))
  assert.deepEqual(PAY_TIERS.map((tier) => tier.label), GAUGE_TIERS.map((tier) => tier.label))
  assert.deepEqual(PAY_TIERS.map((tier) => tier.range), [
    'Under $30', '$30\u201335', '$35\u201340', '$40\u201345', '$45\u201350', '$50\u2013100', 'Above $100',
  ])
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'orange').color, GAUGE_PALETTE.orange.light.accent)
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'purple').color, GAUGE_PALETTE.purple.light.accent)
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'orange').color, '#F56600')
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'purple').color, '#522D80')
  assert.equal(PAY_TIERS.find((tier) => tier.id === 'crown').color, GAUGE_PALETTE.crown.light.gradient[1])
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
  for (const cents of [0, 2999, 3000, 3499, 3500, 3999, 4000, 4499, 4500, 4999, 5000, 10000, 10001]) {
    assert.equal(worthItTierForHourlyCents(cents).id, gaugeTier(cents / 100))
  }
})
