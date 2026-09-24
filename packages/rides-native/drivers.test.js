import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeDriver,
  driverApproach,
  driverAvailabilityLine,
  formatDriverDistance,
  groupDriversForPicker,
  normalizeFavoriteDriverIds,
  OPEN_POOL_COPY,
  PREFERRED_CANCELED_COPY,
  PREFERRED_MATCH_COPY,
  PREFERRED_OFFLINE_COPY,
  preferredTripFields,
  sortPreferredDrivers,
} from './drivers.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

test('preferred-driver copy says a decline does not auto-match', () => {
  assert.match(PREFERRED_MATCH_COPY, /does not auto-match/)
  assert.match(PREFERRED_MATCH_COPY, /canceled/)
  assert.match(PREFERRED_OFFLINE_COPY, /does not auto-match/)
  assert.match(PREFERRED_CANCELED_COPY, /not offered to another driver/)
  assert.match(OPEN_POOL_COPY, /first available driver/)
  assert.deepEqual(preferredTripFields(A), { preferred_driver_id: A, match: 'preferred' })
})

test('eta uses coordinates already on the driver and skips a missing pin', () => {
  const near = driverApproach(
    { lat: 34.6788, lng: -82.843 },
    { lat: 34.6933, lng: -82.843 },
  )
  assert.ok(near.distanceMi > 0.8 && near.distanceMi < 1.3)
  assert.ok(near.etaMin >= 1 && near.etaMin <= 6)
  assert.deepEqual(driverApproach({ lat: null, lng: null }, { lat: 1, lng: 2 }), { etaMin: null, distanceMi: null })
  assert.equal(formatDriverDistance(0.04), 'under 0.1 mi')
  assert.equal(formatDriverDistance(1.24), '1.2 mi')
})

test('availability and card copy stay quiet when the driver is offline', () => {
  assert.equal(driverAvailabilityLine({ online: true, priorityMode: true }), 'Online · Priority')
  assert.equal(driverAvailabilityLine({ online: false }), 'Offline')
  assert.match(
    driverAvailabilityLine({ online: true, updatedAt: '2020-01-01T00:00:00.000Z' }, new Date('2026-01-01T00:00:00.000Z')),
    /location may be stale/,
  )
  const offline = describeDriver({
    online: false,
    lat: 34.68,
    lng: -82.84,
    ratingAvg: 4.8,
    ratingCount: 3,
  }, { lat: 34.69, lng: -82.84 })
  assert.equal(offline.etaLabel, null)
  assert.equal(offline.availability, 'Offline')
  assert.equal(offline.ratingLabel, '4.8 · 3 ratings')
  const fresh = describeDriver({ online: true, lat: 34.6788, lng: -82.843, ratingCount: 0 }, { lat: 34.6788, lng: -82.843 })
  assert.equal(fresh.ratingLabel, 'New driver')
  assert.equal(fresh.etaLabel, '1 min')
})

test('favorites keep uuid ids, and preferred online drivers sort first', () => {
  assert.deepEqual(normalizeFavoriteDriverIds(['  ' + A + ' ', A, '', 3, 'nope', B]), [A, B])
  const drivers = [
    { id: B, name: 'Bea', online: true, lat: 34.7, lng: -82.84 },
    { id: A, name: 'Ada', online: false, lat: 34.68, lng: -82.84 },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Cam', online: true, lat: 34.679, lng: -82.843 },
  ]
  const sorted = sortPreferredDrivers(drivers, [A], { lat: 34.6788, lng: -82.843 })
  assert.equal(sorted[0].id, A)
  assert.equal(sorted[1].name, 'Cam')
  const groups = groupDriversForPicker(sorted, [A])
  assert.deepEqual(groups.preferred.map((row) => row.id), [A])
  assert.equal(groups.online.some((row) => row.id === A), false)
  assert.equal(groups.online.length, 2)
})
