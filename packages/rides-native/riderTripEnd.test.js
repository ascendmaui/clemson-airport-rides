import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_RIDER_STARS,
  defaultTipChoiceId,
  endScreenCanComplete,
  tipRecordBody,
} from './riderTripEnd.js'

test('the end screen starts at five stars and a server tip choice', () => {
  assert.equal(AUTO_RIDER_STARS, 5)
  const offer = {
    popularId: 'pct-20',
    presets: [
      { id: 'pct-15', percent: 15, cents: 300 },
      { id: 'pct-20', percent: 20, cents: 400, popular: true },
      { id: 'pct-25', percent: 25, cents: 500 },
    ],
  }
  assert.equal(defaultTipChoiceId(offer), 'pct-20')
  assert.equal(defaultTipChoiceId({ ...offer, choice: { id: 'pct-15' } }), null)
  assert.equal(defaultTipChoiceId({ ...offer, chargedTipCents: 400 }), null)
})

test('complete trip sends a tip choice without a client fare or charge amount', () => {
  const preset = tipRecordBody('trip-1', 'pct-20')
  assert.equal(preset.ok, true)
  assert.deepEqual(preset.body, { mode: 'record', tripId: 'trip-1', choiceId: 'pct-20' })
  assert.equal('fareCents' in preset.body, false)
  assert.equal('amount' in preset.body, false)
  assert.equal('tipCents' in preset.body, false)

  const custom = tipRecordBody('trip-1', 'custom', '4.50')
  assert.deepEqual(custom.body, { mode: 'record', tripId: 'trip-1', choiceId: 'custom', customDollars: '4.50' })
  assert.equal(tipRecordBody('trip-1', 'custom', '   ').ok, false)

  assert.equal(endScreenCanComplete({ stars: 5, choiceId: 'pct-15', customDollars: '', needsTip: true }).ok, true)
  assert.equal(endScreenCanComplete({ stars: 5, choiceId: 'custom', customDollars: '', needsTip: true }).ok, false)
  assert.equal(endScreenCanComplete({ stars: 5, choiceId: null, needsTip: false }).ok, true)
  assert.equal(endScreenCanComplete({ stars: 0, choiceId: 'pct-20', needsTip: true }).ok, false)
  const skip = tipRecordBody('trip-1', 'skip')
  assert.deepEqual(skip.body, { mode: 'record', tripId: 'trip-1', choiceId: 'skip' })
})
