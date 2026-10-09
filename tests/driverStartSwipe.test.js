import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('at pickup the driver confirms the rider by name and photo, then swipes to start', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /trip\.status === 'arrived' \? \(\s*<RiderConfirmCard/)
  assert.match(trip, /photoUrl=\{person\?\.photoUrl \|\| trip\.riderAvatarUrl \|\| null\}/)
  assert.match(trip, /onStart=\{onAdvance\}/)
  // No tap-to-start button while arrived.
  assert.match(trip, /action && trip\?\.status !== 'arriving' && trip\?\.status !== 'arrived' \? <Primary/)
})

test('the swipe control cannot fire on a tap and keeps an accessibility action', () => {
  const swipe = read('apps/driver/components/SwipeToStart.tsx')
  assert.match(swipe, /swipeConfirms\(g\.dx, trackRef\.current, KNOB\)/)
  assert.doesNotMatch(swipe, /onPress=/)
  assert.match(swipe, /accessibilityActions=\{\[\{ name: 'activate'/)
  assert.match(swipe, /actionName === 'activate' && !disabled/)
})
