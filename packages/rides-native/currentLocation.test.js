import assert from 'node:assert/strict'
import test from 'node:test'
import { captureCurrentLocationPickup } from './currentLocation.js'
import { CURRENT_LOCATION_LABEL } from './places.js'

test('current location asks before GPS and returns no fix when the rider denies', async () => {
  let reads = 0
  const result = await captureCurrentLocationPickup(
    async () => false,
    async () => {
      reads += 1
      return { lat: 34.68, lng: -82.84 }
    },
  )
  assert.deepEqual(result, { ok: false, reason: 'denied' })
  assert.equal(reads, 0)
})

test('current location uses only the fresh fix after allow', async () => {
  const result = await captureCurrentLocationPickup(
    async () => true,
    async () => ({ lat: 34.6836, lng: -82.8364 }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.place.label, CURRENT_LOCATION_LABEL)
  assert.equal(result.place.lat, 34.6836)
  assert.equal(result.place.lng, -82.8364)
})

test('a failed GPS read does not invent coordinates', async () => {
  const denied = await captureCurrentLocationPickup(
    async () => true,
    async () => {
      const err = new Error('denied')
      err.reason = 'denied'
      throw err
    },
  )
  assert.deepEqual(denied, { ok: false, reason: 'denied' })

  const unavailable = await captureCurrentLocationPickup(
    async () => true,
    async () => ({ lat: Number.NaN, lng: -82 }),
  )
  assert.deepEqual(unavailable, { ok: false, reason: 'unavailable' })
})
