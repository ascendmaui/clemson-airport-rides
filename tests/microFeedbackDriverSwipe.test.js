import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSwipeController } from '../packages/rides-native/swipeConfirm.js'

const swipe = readFileSync(new URL('../apps/driver/components/SwipeToStart.tsx', import.meta.url), 'utf8')
const logic = readFileSync(new URL('../packages/rides-native/swipeConfirm.js', import.meta.url), 'utf8')

test('swipe-to-start gives a touch tick, one threshold bump, and a success haptic on confirm', () => {
  assert.match(swipe, /import \* as Haptics from 'expo-haptics'/)
  assert.match(swipe, /Haptics\.selectionAsync\(\)/)
  assert.match(swipe, /case 'threshold':\s*Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Medium\)/)
  assert.match(swipe, /case 'success':\s*Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/)
  // Success haptic, then the accept/start handler. Not the other way around, and not inside a cancelled animation.
  assert.match(logic, /onCue\('success'\)\s*onAccept\?\.\(\)/)
})

test('the threshold bump fires on the rising edge and a finished swipe accepts once', () => {
  let accepts = 0
  const cues = []
  const controller = createSwipeController({
    knobWidth: 60,
    getTrackWidth: () => 300,
    onAccept: () => { accepts += 1 },
    onCue: (cue) => cues.push(cue),
  })
  controller.move(204)
  controller.move(240)
  controller.move(100)
  controller.move(210)
  assert.deepEqual(cues, ['threshold', 'threshold'])
  controller.release(210)
  controller.release(240)
  assert.equal(accepts, 1)
  assert.deepEqual(cues, ['threshold', 'threshold', 'success'])
  controller.begin()
  controller.move(204)
  assert.equal(cues.filter((cue) => cue === 'threshold').length, 3)
})
