import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOST_RIDER_HELPER,
  BOOST_SCHEDULE_NOTE,
  boostHowItWorks,
  driverBoostOfferLine,
  riderBoostChosenLine,
} from './boost.js'

const JARGON = /pre-auth|authorization|paymentintent|buffer|commission/i

test('rider boost copy is short, numbered, and free of payment jargon', () => {
  const sheet = boostHowItWorks()
  assert.equal(sheet.title, 'How a boost works')
  assert.match(sheet.intro, /extra money/)
  assert.equal(sheet.steps.length, 5)
  assert.match(sheet.steps[0], /\$5, \$10, \$15, or \$20/)
  assert.match(sheet.steps[0], /\$100/)
  assert.match(sheet.steps[1], /keeps all of it/)
  assert.match(sheet.steps[2], /hold on your card/)
  assert.match(sheet.steps[2], /charged when the ride ends/)
  assert.match(sheet.steps[3], /until a driver accepts/)
  assert.match(sheet.steps[4], /refunded/)
  const blob = [BOOST_RIDER_HELPER, BOOST_SCHEDULE_NOTE, sheet.intro, ...sheet.steps].join(' ')
  assert.doesNotMatch(blob, JARGON)
  assert.match(BOOST_RIDER_HELPER, /driver sooner/)
  assert.match(BOOST_SCHEDULE_NOTE, /hold on your card/)
})

test('driver offer line names the boost and says it is all theirs', () => {
  assert.equal(
    driverBoostOfferLine(1000),
    "The rider added $10 to get this ride accepted. It's all yours.",
  )
  assert.equal(
    driverBoostOfferLine(1500),
    "The rider added $15 to get this ride accepted. It's all yours.",
  )
  assert.match(riderBoostChosenLine(2000), /\$20/)
  assert.doesNotMatch(driverBoostOfferLine(1000), JARGON)
})
