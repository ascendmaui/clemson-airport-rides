import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isFavoriteRider,
  normalizeAutoAccept,
  shouldAutoAccept,
  withFavoriteRider,
  withoutFavoriteRider,
} from './autoAccept.js'

const offer = { riderId: 'rider-1', pickupMiles: 2.4, hourlyCents: 2800 }

test('auto-accept stays off until a rule is enabled', () => {
  assert.deepEqual(shouldAutoAccept(offer, normalizeAutoAccept(null)), { accept: false, reason: 'off' })
})

test('distance and hourly thresholds must both pass when both are on', () => {
  const settings = normalizeAutoAccept({
    distanceEnabled: true,
    maxPickupMiles: 3,
    hourlyEnabled: true,
    minHourlyCents: 2500,
  })
  assert.equal(shouldAutoAccept(offer, settings).reason, 'distance_and_hourly')
  assert.equal(shouldAutoAccept({ ...offer, pickupMiles: 6 }, settings).reason, 'beyond_distance')
  assert.equal(shouldAutoAccept({ ...offer, hourlyCents: 1800 }, settings).reason, 'below_hourly')
  assert.equal(shouldAutoAccept(offer, { ...settings, hourlyEnabled: false }).reason, 'distance')
})

test('favorite riders auto-accept even when the fare is below the hourly bar', () => {
  const settings = withFavoriteRider({
    favoritesEnabled: true,
    hourlyEnabled: true,
    minHourlyCents: 4000,
    distanceEnabled: true,
    maxPickupMiles: 1,
  }, { id: 'rider-1', name: 'Ava' })
  assert.equal(isFavoriteRider(settings, 'rider-1'), true)
  assert.equal(shouldAutoAccept({ ...offer, pickupMiles: 12, hourlyCents: 100 }, settings).reason, 'favorite_rider')
  const removed = withoutFavoriteRider(settings, 'rider-1')
  assert.equal(shouldAutoAccept(offer, removed).reason, 'beyond_distance')
})
