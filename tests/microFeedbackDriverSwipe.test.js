import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const swipe = readFileSync(new URL('../apps/driver/components/SwipeToStart.tsx', import.meta.url), 'utf8')

test('swipe-to-start gives a touch tick, one threshold bump, and a success haptic on confirm', () => {
  assert.match(swipe, /import \* as Haptics from 'expo-haptics'/)
  assert.match(swipe, /onPanResponderGrant: \(\) => \{\s*Haptics\.selectionAsync\(\)/)
  assert.match(swipe, /if \(armed && !armedRef\.current\) Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Medium\)/)
  assert.match(swipe, /Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)[\s\S]*confirmRef\.current\(\)/)
})

test('the threshold bump re-arms only after reset, so it cannot buzz repeatedly', () => {
  assert.match(swipe, /armedRef\.current = armed/)
  assert.match(swipe, /const reset = \(\) => \{\s*armedRef\.current = false/)
})
