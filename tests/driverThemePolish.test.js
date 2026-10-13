import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { color, motion, motionDuration, radius, type } from '../packages/rides-native/shared/theme.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('shared tokens are the rider cream, orange, and purple scale', () => {
  assert.equal(color.surface, '#F7F4F0')
  assert.equal(color.orange, '#F56600')
  assert.equal(color.purple, '#522D80')
  assert.equal(radius.lg, 18)
  assert.equal(radius.xl, 22)
  assert.equal(radius.sheet, 28)
  assert.equal(type.button.letterSpacing, -0.2)
  assert.equal(type.title.letterSpacing, -0.4)
  assert.equal(motionDuration(motion.enterFadeMs, false), 320)
  assert.equal(motionDuration(motion.enterRiseMs, true), 0)
})

test('driver chrome, stack pages, and motion use the shared tokens', () => {
  const chrome = read('apps/driver/components/chrome.tsx')
  const shell = read('apps/driver/components/shell.tsx')
  const enter = read('apps/driver/lib/enterMotion.tsx')
  const day = read('apps/driver/components/day.tsx')
  assert.match(chrome, /rides-native\/shared\/theme\.js/)
  assert.match(chrome, /radius\.lg/)
  assert.match(chrome, /typeScale\.button/)
  assert.match(chrome, /shadowStyle/)
  assert.match(shell, /<Enter/)
  assert.match(shell, /typeScale\.headline/)
  assert.match(enter, /motion\.enterFadeMs/)
  assert.match(enter, /useReduceMotion/)
  assert.match(enter, /Easing\.out\(Easing\.cubic\)/)
  assert.match(day, /<Enter/)
})

test('listed driver surfaces pick up the shared type and radius scale', () => {
  const files = [
    'apps/driver/app/onboarding.tsx',
    'apps/driver/app/documents.tsx',
    'apps/driver/app/safety.tsx',
    'apps/driver/app/(tabs)/earnings.tsx',
    'apps/driver/app/tax.tsx',
    'apps/driver/app/payouts.tsx',
    'apps/driver/app/vehicles.tsx',
    'apps/driver/app/trip.tsx',
    'apps/driver/components/EarningsBoard.tsx',
    'apps/driver/components/RiderConfirmCard.tsx',
    'apps/driver/components/TripEndSummary.tsx',
  ]
  for (const file of files) {
    const source = read(file)
    assert.match(source, /rides-native\/shared\/theme\.js/, file)
  }
  assert.match(read('apps/driver/app/documents.tsx'), /VEHICLE CHECK/)
  assert.match(read('apps/driver/app/safety.tsx'), /radius\.lg/)
  assert.match(read('packages/rides-native/SafetyDeck.jsx'), /useReduceMotion/)
  assert.match(read('packages/rides-native/AudioCaptureCard.jsx'), /radius\.lg/)
})

test('gesture and cluster logic stay in place', () => {
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const shell = read('apps/driver/components/shell.tsx')
  const swipe = read('apps/driver/components/SwipeToStart.tsx')
  assert.match(shell, /\{online \? 'END' : 'GO'\}/)
  assert.match(home, /styles\.clutter/)
  assert.match(home, /withSpring\(HOME_CLUTTER_SHIFT, HOME_CLUTTER_SPRING\)/)
  assert.match(home, /homeClutterTranslateY\(false\)/)
  // Gesture-handler pan, not a tap. The knob logic stays with the slider.
  assert.match(swipe, /Gesture\.Pan\(\)/)
  assert.match(swipe, /onUpdate/)
  assert.doesNotMatch(swipe, /onPress=/)
  assert.match(home, /useReduceMotion/)
})
