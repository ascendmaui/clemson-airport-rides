import test from 'node:test'
import assert from 'node:assert/strict'
import { isActiveTripLocationStatus, newestTripLocation, shouldPublishTripLocation } from './backgroundLocation.js'

const location = (timestamp, latitude = 34.68, longitude = -82.84) => ({
  timestamp, coords: { latitude, longitude, heading: 90, speed: 12 },
})

test('only accepted through in_progress trips allow background location', () => {
  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress']) {
    assert.equal(isActiveTripLocationStatus(status), true, status)
  }
  for (const status of ['completed', 'canceled', 'canceled_midride', 'cancelled_wait', 'offered', 'searching', 'scheduled', '', null, undefined]) {
    assert.equal(isActiveTripLocationStatus(status), false, String(status))
  }
})

test('a batch publishes the newest valid fix, preserving heading and speed', () => {
  const newest = location(3000)
  const batch = [location(1000), newest, location(2000)]
  assert.equal(newestTripLocation(batch), newest)
  assert.deepEqual(batch.map((fix) => fix.timestamp), [1000, 3000, 2000])
  assert.equal(newestTripLocation([newest, location(4000, NaN), location(5000, 91), location(6000, 0, -181)]), newest)
  assert.equal(newestTripLocation([location(NaN), null, {}]), null)
  assert.equal(newestTripLocation([]), null)
  assert.equal(newestTripLocation(undefined), null)
  assert.equal(newestTripLocation(null), null)
  assert.deepEqual(newestTripLocation([location(0, 0, 0)]), location(0, 0, 0))
})

test('foreground and background share an exact four-second publish boundary', () => {
  assert.equal(shouldPublishTripLocation(null, 10000), true)
  assert.equal(shouldPublishTripLocation(10000, 10000), false)
  assert.equal(shouldPublishTripLocation(10000, 13999), false)
  assert.equal(shouldPublishTripLocation(10000, 14000), true)
  assert.equal(shouldPublishTripLocation(10000, 15000), true)
  assert.equal(shouldPublishTripLocation(0, 3999), false)
  assert.equal(shouldPublishTripLocation(0, 4000), true)
  assert.equal(shouldPublishTripLocation(NaN, 10000), true)
  assert.equal(shouldPublishTripLocation(10000, 9000), true, 'recover after a clock correction')
  assert.equal(shouldPublishTripLocation(null, NaN), false)
})
