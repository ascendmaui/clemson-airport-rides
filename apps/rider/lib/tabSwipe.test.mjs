import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RIDER_MAIN_TABS,
  TAB_SWIPE_DISTANCE_RATIO,
  TAB_SWIPE_EDGE_PX,
  TAB_SWIPE_VELOCITY,
  applyTabNavigation,
  nextTabIndex,
  prevTabIndex,
  swipeDirection,
  tabIndexForPath,
  tabRequiresAuth,
  tabSwipeAllowed,
  tabSwipeStartFromPoint,
} from './tabSwipe.ts'

const COUNT = RIDER_MAIN_TABS.length

test('main tabs are Rides, Schedule, Friends, Account', () => {
  assert.deepEqual(
    RIDER_MAIN_TABS.map((tab) => tab.label),
    ['Rides', 'Schedule', 'Friends', 'Account'],
  )
  assert.deepEqual(
    RIDER_MAIN_TABS.map((tab) => tab.href),
    ['/', '/schedule', '/friends', '/account'],
  )
})

test('next and prev clamp at the ends', () => {
  assert.equal(nextTabIndex(0, COUNT), 1)
  assert.equal(nextTabIndex(1, COUNT), 2)
  assert.equal(nextTabIndex(2, COUNT), 3)
  assert.equal(nextTabIndex(3, COUNT), 3)
  assert.equal(nextTabIndex(99, COUNT), 3)
  assert.equal(prevTabIndex(0, COUNT), 0)
  assert.equal(prevTabIndex(1, COUNT), 0)
  assert.equal(prevTabIndex(2, COUNT), 1)
  assert.equal(prevTabIndex(3, COUNT), 2)
  assert.equal(prevTabIndex(-4, COUNT), 0)
  assert.equal(nextTabIndex(Number.NaN, COUNT), 1)
  assert.equal(prevTabIndex(Number.NaN, COUNT), 0)
})

test('swipe and tap both update the same active index', () => {
  for (let index = 0; index < COUNT; index += 1) {
    const next = nextTabIndex(index, COUNT)
    const prev = prevTabIndex(index, COUNT)
    assert.equal(
      applyTabNavigation(index, { type: 'tap', index: next }, COUNT),
      applyTabNavigation(index, { type: 'swipe', direction: 'next' }, COUNT),
      `next from ${index}`,
    )
    assert.equal(
      applyTabNavigation(index, { type: 'tap', index: prev }, COUNT),
      applyTabNavigation(index, { type: 'swipe', direction: 'prev' }, COUNT),
      `prev from ${index}`,
    )
  }
  assert.equal(applyTabNavigation(0, { type: 'tap', index: 2 }, COUNT), 2)
  assert.equal(applyTabNavigation(0, { type: 'swipe', direction: 'next' }, COUNT), 1)
  assert.equal(applyTabNavigation(3, { type: 'swipe', direction: 'next' }, COUNT), 3)
  assert.equal(applyTabNavigation(0, { type: 'swipe', direction: 'prev' }, COUNT), 0)
  assert.equal(applyTabNavigation(2, { type: 'swipe', direction: 'stay' }, COUNT), 2)
  assert.equal(applyTabNavigation(1, { type: 'tap', index: 8 }, COUNT), 3)
})

test('a flick and a long drag resolve to the same tab as a tap', () => {
  const width = 400
  const distance = width * TAB_SWIPE_DISTANCE_RATIO
  for (let index = 0; index < COUNT; index += 1) {
    const next = swipeDirection(-distance, 0, width)
    const prev = swipeDirection(distance, 0, width)
    assert.equal(next, 'next')
    assert.equal(prev, 'prev')
    assert.equal(
      applyTabNavigation(index, { type: 'swipe', direction: next }, COUNT),
      applyTabNavigation(index, { type: 'tap', index: nextTabIndex(index, COUNT) }, COUNT),
    )
    assert.equal(
      applyTabNavigation(index, { type: 'swipe', direction: prev }, COUNT),
      applyTabNavigation(index, { type: 'tap', index: prevTabIndex(index, COUNT) }, COUNT),
    )
  }
  assert.equal(swipeDirection(-10, -TAB_SWIPE_VELOCITY, width), 'next')
  assert.equal(swipeDirection(10, TAB_SWIPE_VELOCITY, width), 'prev')
  assert.equal(swipeDirection(-distance + 1, 0, width), 'stay')
  assert.equal(swipeDirection(Number.NaN, 0, width), 'stay')
  assert.equal(swipeDirection(40, 0, 0), 'stay')
})

test('paths land on the matching tab', () => {
  assert.equal(tabIndexForPath('/'), 0)
  assert.equal(tabIndexForPath('/schedule'), 1)
  assert.equal(tabIndexForPath('/friends'), 2)
  assert.equal(tabIndexForPath('/account'), 3)
  assert.equal(tabIndexForPath('/(tabs)/schedule'), 1)
  assert.equal(tabIndexForPath('/history'), 0)
  assert.equal(tabRequiresAuth('rides'), false)
  assert.equal(tabRequiresAuth('friends'), false)
  assert.equal(tabRequiresAuth('schedule'), true)
  assert.equal(tabRequiresAuth('account'), false)
})

test('map and sheet swipes stay put unless they start at the screen edge', () => {
  const width = 400
  const map = { x: 0, y: 0, width: 400, height: 300 }
  const sheet = { x: 0, y: 280, width: 400, height: 500 }
  const chips = [{ x: 0, y: 420, width: 400, height: 40 }]

  function start(x, y, ridesMapTab = true) {
    return tabSwipeStartFromPoint({ x, y, width, ridesMapTab, map, sheet, horizontal: chips })
  }

  assert.equal(tabSwipeAllowed(start(200, 120)), false)
  assert.equal(tabSwipeAllowed(start(200, 400)), false)
  assert.equal(tabSwipeAllowed(start(8, 120)), true)
  assert.equal(tabSwipeAllowed(start(width - TAB_SWIPE_EDGE_PX, 400)), true)
  assert.equal(tabSwipeAllowed(start(30, 430)), false)
  assert.equal(tabSwipeAllowed(start(8, 430)), false)
  assert.equal(tabSwipeAllowed(start(200, 120, false)), true)
  assert.equal(tabSwipeAllowed(start(80, 430, false)), false)
  assert.equal(tabSwipeAllowed({ ...start(200, 40), onMap: false, onSheet: false, ridesMapTab: true }), true)
  assert.equal(tabSwipeAllowed({ x: 10, width: 0, onMap: false, onSheet: false, onHorizontalControl: false, ridesMapTab: false }), false)
})
