import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  FARE_UNKNOWN_TIP_NOTE,
  TIP_PERCENTS,
  customTipCents,
  tipCentsForPercent,
  tipChargeBody,
  tipPresetView,
} from './tipPresets.js'

test('main tip buttons are 15, 20, and 25 percent of the fare', () => {
  assert.deepEqual(TIP_PERCENTS, [15, 20, 25])
  assert.equal(tipCentsForPercent(4000, 15), 600)
  assert.equal(tipCentsForPercent(4000, 20), 800)
  assert.equal(tipCentsForPercent(4000, 25), 1000)
  assert.equal(tipCentsForPercent(3333, 15), 500)
})

test('percent buttons show the dollar amount when the fare is known', () => {
  const rows = tipPresetView(4000)
  assert.deepEqual(rows.map((row) => [row.percent, row.detail, row.chargeable]), [
    [15, '$6.00', true],
    [20, '$8.00', true],
    [25, '$10.00', true],
  ])
  assert.match(rows[1].label, /20%/)
  assert.doesNotMatch(rows.map((row) => row.label).join(' '), /\$2|\$5|\$10/)
})

test('percent buttons do not invent a fare', () => {
  const rows = tipPresetView(null)
  assert.equal(rows.every((row) => row.cents == null && row.detail == null && row.chargeable === false), true)
  assert.match(FARE_UNKNOWN_TIP_NOTE, /Fare is not on this ride yet/)
  assert.equal(tipCentsForPercent(undefined, 20), null)
  assert.equal(tipCentsForPercent('', 20), null)
})

test('a percent below $1 or above $100 is not chargeable', () => {
  const tiny = tipPresetView(100)
  assert.equal(tiny[0].cents, 15)
  assert.equal(tiny[0].chargeable, false)
  assert.equal(tiny[2].detail, '$0.25')
})

test('custom amount is dollars, and a percent body ignores a dollar field', () => {
  assert.deepEqual(customTipCents('8.50'), { cents: 850 })
  assert.equal(customTipCents('0.50').error, 'Tip must be between $1 and $100')
  assert.deepEqual(tipChargeBody({ tripId: 't1', percent: 20, customCents: 200 }), {
    tripId: 't1',
    mode: 'charge',
    tipPercent: 20,
  })
  assert.deepEqual(tipChargeBody({ tripId: 't1', customCents: 750 }), {
    tripId: 't1',
    mode: 'charge',
    tipCents: 750,
  })
})

test('rider tip screens do not offer $2, $5, and $10 presets', () => {
  const web = readFileSync(new URL('../../src/components/TipCharge.jsx', import.meta.url), 'utf8')
  const native = readFileSync(new URL('../../apps/rider/app/tip.tsx', import.meta.url), 'utf8')
  for (const source of [web, native]) {
    assert.match(source, /15%|tipPresetView/)
    assert.doesNotMatch(source, /\[200,\s*500,\s*1000\]/)
    assert.doesNotMatch(source, /\$2,\s*\$5,\s*\$10/)
  }
})
