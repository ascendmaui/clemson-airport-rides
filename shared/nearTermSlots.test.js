import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRiderMatchNotice,
  currentWaitFromDrivers,
  matchRequestedSlot,
  nearTermScheduleRoute,
  offerNearTermSlots,
  scheduledBoardCopy,
  SLOT_MATCH_TOLERANCE_MS,
} from './nearTermSlots.js'

const NOW = new Date('2026-10-05T15:00:00.000Z')
const PICKUP = { lat: 34.6788, lng: -82.843 }

test('slots are 10 to 15 minutes when the wait is under 10', () => {
  const offered = offerNearTermSlots({ waitMinutes: 4, now: NOW })
  assert.deepEqual(offered.slots.map((slot) => slot.minutesOut), [10, 11, 12, 13, 14, 15])
  assert.equal(offered.slots[0].pickupAt, new Date(NOW.getTime() + 10 * 60 * 1000).toISOString())
  assert.equal(offered.reason, null)
})

test('slots start at the current wait when it falls inside the window', () => {
  const offered = offerNearTermSlots({ waitMinutes: 12.2, now: NOW })
  assert.deepEqual(offered.slots.map((slot) => slot.minutesOut), [13, 14, 15])
})

test('a wait past 15 minutes offers no slot', () => {
  const offered = offerNearTermSlots({ waitMinutes: 16, now: NOW })
  assert.deepEqual(offered.slots, [])
  assert.equal(offered.reason, 'wait_beyond_window')
  assert.match(offered.emptyMessage, /10 to 15/)
})

test('wait uses the nearest fresh driver and ignores demo cars', () => {
  const wait = currentWaitFromDrivers([
    {
      id: 'demo-marcus',
      simulated: true,
      available: true,
      lat: PICKUP.lat,
      lng: PICKUP.lng,
      updated_at: NOW.toISOString(),
    },
    {
      id: 'far',
      available: true,
      lat: 34.75,
      lng: -82.9,
      updated_at: NOW.toISOString(),
    },
    {
      id: 'near',
      available: true,
      lat: 34.682,
      lng: -82.84,
      updated_at: NOW.toISOString(),
    },
    {
      id: 'stale',
      available: true,
      lat: PICKUP.lat,
      lng: PICKUP.lng,
      updated_at: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
    },
  ], PICKUP, NOW)
  assert.equal(wait.reason, null)
  assert.equal(wait.availableDrivers, 3)
  assert.ok(wait.waitMinutes >= 1)
  assert.ok(wait.waitMinutes < 10)
  const offered = offerNearTermSlots({ waitMinutes: wait.waitMinutes, now: NOW, reason: wait.reason })
  assert.equal(offered.slots[0].minutesOut, 10)
  assert.equal(offered.slots.at(-1).minutesOut, 15)
})

test('no available drivers and missing locations do not invent a slot', () => {
  assert.equal(currentWaitFromDrivers([], PICKUP, NOW).reason, 'no_drivers')
  const located = currentWaitFromDrivers([{ id: 'a', available: true, lat: null, lng: null, updated_at: NOW.toISOString() }], PICKUP, NOW)
  assert.equal(located.reason, 'no_location')
  assert.equal(offerNearTermSlots({ waitMinutes: null, reason: 'no_location', now: NOW }).slots.length, 0)
})

test('a requested pickup matches the closest slot inside the tolerance', () => {
  const offered = offerNearTermSlots({ waitMinutes: 8, now: NOW })
  const target = new Date(new Date(offered.slots[2].pickupAt).getTime() + 20_000)
  const matched = matchRequestedSlot(offered.slots, target)
  assert.equal(matched.id, 'm12')
  assert.equal(matchRequestedSlot(offered.slots, new Date(NOW.getTime() + 30 * 60 * 1000)), null)
  assert.ok(SLOT_MATCH_TOLERANCE_MS < 2 * 60 * 1000)
})

test('board copy and match pop-up name the driver, distance, and pickup time', () => {
  const board = scheduledBoardCopy({
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'Sikes Hall',
    pickup_at: '2026-10-05T15:12:00.000Z',
  })
  assert.equal(board.title, 'Scheduled ride on the board')
  assert.match(board.body, /Memorial Stadium → Sikes Hall/)
  const notice = buildRiderMatchNotice({
    driverName: 'Ava Stone',
    distanceMi: 1.24,
    etaMin: 6,
    pickupAt: '2026-10-05T15:12:00.000Z',
    now: NOW,
  })
  assert.equal(notice.driverName, 'Ava')
  assert.equal(notice.distanceLabel, '1.2 mi')
  assert.match(notice.body, /Ava is 1.2 mi away/)
  assert.match(notice.body, /6 min/)
  assert.match(notice.body, /Pickup/)
})

test('schedule route is the hook for the looking-for-driver button', () => {
  const route = nearTermScheduleRoute({ pickupLabel: 'Memorial Stadium', dropoffLabel: 'Sikes Hall', tier: 'standard' })
  assert.equal(route.native.pathname, '/schedule')
  assert.equal(route.native.params.near, '1')
  assert.equal(route.native.params.pickup, 'Memorial Stadium')
  assert.equal(route.web.path, 'schedule')
  assert.equal(route.web.params.dropoff, 'Sikes Hall')
})
