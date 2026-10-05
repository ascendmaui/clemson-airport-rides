import assert from 'node:assert/strict'
import test from 'node:test'
import { distanceMeters, isLiveTrip, shouldPublishLocation } from '../src/lib/liveDriverLocation.js'

// Covered by the existing tests/no*.test.js entry in package.json.
test('only active trip states enable private location tracking', () => {
  assert.equal(isLiveTrip('accepted'), true)
  assert.equal(isLiveTrip('in_progress'), true)
  assert.equal(isLiveTrip('completed'), false)
  assert.equal(isLiveTrip('searching'), false)
})

test('location publishing throttles by time but sends meaningful movement promptly', () => {
  const last = { lat: 34.6784, lng: -82.8397, publishedAt: 1000 }
  assert.equal(shouldPublishLocation(last, { lat: 34.67841, lng: -82.8397 }, 3000), false)
  assert.equal(shouldPublishLocation(last, { lat: 34.6784, lng: -82.8395 }, 3000), true)
  assert.equal(shouldPublishLocation(last, { lat: 34.67841, lng: -82.8397 }, 5000), true)
  assert.ok(distanceMeters(last, { lat: 34.6784, lng: -82.8395 }) > 15)
})
