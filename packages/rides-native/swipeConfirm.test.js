import assert from 'node:assert/strict'
import test from 'node:test'
import { SWIPE_CONFIRM_THRESHOLD, createSwipeController, riderConfirmCopy, settleSwipe, swipeConfirms, swipeOffset, swipeProgress, swipeTravel } from './swipeConfirm.js'

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

test('past the threshold triggers onAccept once, below it resets', () => {
  let accepts = 0
  const onAccept = () => { accepts += 1 }
  const below = settleSwipe({ dx: 200, trackWidth: 300, knobWidth: 60, onAccept })
  assert.equal(below.action, 'reset')
  assert.equal(below.accepted, false)
  assert.equal(accepts, 0)
  const past = settleSwipe({ dx: 204, trackWidth: 300, knobWidth: 60, onAccept })
  assert.equal(past.action, 'accept')
  assert.equal(past.accepted, true)
  assert.equal(accepts, 1)
  const again = settleSwipe({ dx: 500, trackWidth: 300, knobWidth: 60, accepted: true, onAccept })
  assert.equal(again.action, 'reset')
  assert.equal(again.accepted, true)
  assert.equal(accepts, 1)
  const disabled = settleSwipe({ dx: 500, trackWidth: 300, knobWidth: 60, disabled: true, onAccept })
  assert.equal(disabled.action, 'reset')
  assert.equal(accepts, 1)
})

test('completing the swipe calls the accept handler once, and a short swipe springs back', () => {
  let accepts = 0
  const cues = []
  const controller = createSwipeController({
    knobWidth: 60,
    getTrackWidth: () => 300,
    onAccept: () => { accepts += 1 },
    onCue: (cue) => cues.push(cue),
  })
  const short = controller.release(200)
  assert.equal(short.action, 'reset')
  assert.equal(short.offset, 0)
  assert.equal(accepts, 0)
  controller.begin()
  assert.equal(controller.move(204).crossed, true)
  assert.equal(controller.move(230).crossed, false)
  const done = controller.release(230)
  assert.equal(done.action, 'accept')
  assert.equal(done.offset, 240)
  const duplicate = controller.release(500)
  assert.equal(duplicate.action, 'reset')
  assert.equal(duplicate.offset, 240)
  assert.equal(accepts, 1)
  assert.deepEqual(cues, ['threshold', 'success'])
  controller.begin()
  controller.release(204)
  assert.equal(accepts, 2)
})

test('rider confirm copy uses the first name and mentions the photo only when there is one', () => {
  const withPhoto = riderConfirmCopy({ firstName: 'Riley Smith', photoUrl: 'https://x/y.jpg' })
  assert.equal(withPhoto.title, 'Is this Riley?')
  assert.match(withPhoto.body, /Match the face/)
  assert.equal(withPhoto.swipeLabel, 'Swipe to start trip')
  assert.doesNotMatch(riderConfirmCopy({ firstName: 'Riley' }).body, /face/)
  assert.equal(riderConfirmCopy().title, 'Is this your rider?')
})
