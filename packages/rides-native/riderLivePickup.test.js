import assert from 'node:assert/strict'
import test from 'node:test'
import { toDriverCard } from './tripTags.js'
import {
  RIDER_FIX_MAX_ACCURACY_M,
  RIDER_FIX_MAX_AGE_MS,
  driverPickupTarget,
  normalizeRiderFix,
  shouldPublishRiderFix,
  shouldStreamRiderPickup,
} from './riderLivePickup.js'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')

test('pickup streaming covers booking through arrival and stops once the trip is underway', () => {
  for (const status of ['searching', 'offered', 'accepted', 'arriving', 'arrived']) {
    assert.equal(shouldStreamRiderPickup(status), true)
  }
  assert.equal(shouldStreamRiderPickup('in_progress'), false)
  assert.equal(shouldStreamRiderPickup('completed'), false)
  assert.equal(shouldStreamRiderPickup('canceled'), false)
})

test('a coarse fix is rejected and a few feet of movement publishes', () => {
  assert.equal(normalizeRiderFix({ lat: 34.68, lng: -82.84, accuracy: RIDER_FIX_MAX_ACCURACY_M + 1 }, 't').ok, false)
  assert.equal(normalizeRiderFix({ lat: 91, lng: 0 }, 't').ok, false)
  const fine = normalizeRiderFix({ lat: 34.68, lng: -82.84, accuracy: 8, heading: 90 }, '2026-10-05T12:00:00.000Z')
  assert.equal(fine.ok, true)
  assert.equal(fine.fix.accuracy_m, 8)
  assert.equal(fine.fix.heading, 90)
  assert.equal(shouldPublishRiderFix(null, { lat: 34.68, lng: -82.84, accuracy: 5 }, NOW), true)
  assert.equal(shouldPublishRiderFix(
    { at: NOW, lat: 34.68, lng: -82.84 },
    { lat: 34.68, lng: -82.84, accuracy: 5 },
    NOW + 500,
  ), false)
  assert.equal(shouldPublishRiderFix(
    { at: NOW, lat: 34.68, lng: -82.84 },
    { lat: 34.68002, lng: -82.84, accuracy: 5 },
    NOW + 500,
  ), true)
  assert.equal(shouldPublishRiderFix(
    { at: NOW, lat: 34.68, lng: -82.84 },
    { lat: 34.68, lng: -82.84, accuracy: 5 },
    NOW + 2000,
  ), true)
  assert.equal(shouldPublishRiderFix(null, { lat: 34.68, lng: -82.84, accuracy: 80 }, NOW), false)
})

test('the driver pin follows a fresh rider fix and leaves the booked pickup and fare alone', () => {
  const card = toDriverCard({
    id: 'trip-1',
    status: 'offered',
    pickup_lat: 34.67,
    pickup_lng: -82.84,
    fare_cents: 2000,
    metadata: {
      rider_location: {
        lat: 34.6802,
        lng: -82.8371,
        accuracy_m: 6,
        updated_at: '2026-10-05T12:00:00.000Z',
      },
    },
  })
  assert.equal(card.pickupLat, 34.67)
  assert.equal(card.pickupLng, -82.84)
  assert.equal(card.fareCents, 2000)
  assert.equal(card.riderLat, 34.6802)
  assert.equal(card.riderFixAt, '2026-10-05T12:00:00.000Z')
  const live = driverPickupTarget(card, NOW)
  assert.deepEqual(live, { latitude: 34.6802, longitude: -82.8371, live: true })
  const stale = driverPickupTarget(card, NOW + RIDER_FIX_MAX_AGE_MS + 1)
  assert.deepEqual(stale, { latitude: 34.67, longitude: -82.84, live: false })
  assert.equal(driverPickupTarget({ pickupLat: null, pickupLng: null }), null)
})
