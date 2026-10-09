import assert from 'node:assert/strict'
import test from 'node:test'
import { SWIPE_CONFIRM_THRESHOLD, riderConfirmCopy, swipeConfirms, swipeOffset, swipeProgress, swipeTravel } from './swipeConfirm.js'

test('the knob is clamped to the track', () => {
  assert.equal(swipeTravel(300, 60), 240)
  assert.equal(swipeOffset(-40, 300, 60), 0)
  assert.equal(swipeOffset(120, 300, 60), 120)
  assert.equal(swipeOffset(999, 300, 60), 240)
  assert.equal(swipeProgress(120, 300, 60), 0.5)
})

test('only a near-complete swipe confirms; a tap never does', () => {
  assert.equal(SWIPE_CONFIRM_THRESHOLD, 0.85)
  assert.equal(swipeConfirms(0, 300, 60), false)
  assert.equal(swipeConfirms(5, 300, 60), false)
  assert.equal(swipeConfirms(200, 300, 60), false)
  assert.equal(swipeConfirms(204, 300, 60), true)
  assert.equal(swipeConfirms(500, 300, 60), true)
  assert.equal(swipeConfirms(500, 0, 60), false)
})

test('rider confirm copy uses the first name and mentions the photo only when there is one', () => {
  const withPhoto = riderConfirmCopy({ firstName: 'Riley Smith', photoUrl: 'https://x/y.jpg' })
  assert.equal(withPhoto.title, 'Is this Riley?')
  assert.match(withPhoto.body, /Match the face/)
  assert.equal(withPhoto.swipeLabel, 'Swipe to start trip')
  assert.doesNotMatch(riderConfirmCopy({ firstName: 'Riley' }).body, /face/)
  assert.equal(riderConfirmCopy().title, 'Is this your rider?')
})
