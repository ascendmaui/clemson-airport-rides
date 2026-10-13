import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('at pickup the driver confirms the rider by name and photo, then swipes to start', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /trip\.status === 'arrived' && !multiStop \? \(\s*<RiderConfirmCard/)
  assert.match(trip, /photoUrl=\{person\?\.photoUrl \|\| trip\.riderAvatarUrl \|\| null\}/)
  assert.match(trip, /onStart=\{onAdvance\}/)
  // No tap-to-start button while arrived.
  assert.match(trip, /action && trip\?\.status !== 'arriving' && trip\?\.status !== 'arrived' && \(!multiStop/)
})

test('the swipe control cannot fire on a tap and keeps an accessibility action', () => {
  const swipe = read('apps/driver/components/SwipeToStart.tsx')
  assert.match(swipe, /createSwipeController\(/)
  assert.match(swipe, /onAccept: \(\) => confirmRef\.current\(\)/)
  assert.doesNotMatch(swipe, /onPress=/)
  assert.match(swipe, /accessibilityActions=\{\[\{ name: 'activate'/)
  assert.match(swipe, /actionName === 'activate' && !disabled/)
  // The mutation runs from the release path, not from an animation completion the parent can cancel.
  assert.doesNotMatch(swipe, /withTiming\([\s\S]*confirmRef/)
  assert.doesNotMatch(swipe, /Animated\.timing\([\s\S]*confirmRef/)
})

test('the swipe pan claims the horizontal drag and blocks the screen gesture and sheet scroll', () => {
  const swipe = read('apps/driver/components/SwipeToStart.tsx')
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(swipe, /Gesture\.Pan\(\)/)
  assert.match(swipe, /activeOffsetX\(SWIPE_ACTIVE_OFFSET_X\)/)
  assert.match(swipe, /failOffsetY\(\[-SWIPE_FAIL_OFFSET_Y, SWIPE_FAIL_OFFSET_Y\]\)/)
  assert.match(swipe, /blocksExternalGesture\(blockGesture\)/)
  assert.match(swipe, /gestureEnabled: false/)
  assert.match(swipe, /fullScreenGestureEnabled: false/)
  assert.match(swipe, /controller\.release\(dx\)/)
  assert.match(swipe, /if \(!success \|\| endedRef\.current\) return/)
  assert.match(trip, /scrollEnabled=\{sheetScrollEnabled\}/)
  assert.match(trip, /onSwipeActive=\{\(active\) => setSheetScrollEnabled\(!active\)\}/)
  assert.match(trip, /Gesture\.Native\(\)/)
  assert.match(trip, /blockGesture=\{sheetGesture\}/)
})
