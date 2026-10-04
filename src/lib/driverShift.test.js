import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  canReceiveOffers,
  isOnShift,
  locationFields,
  startShift,
  stopShift,
  visibleOffer,
} from './driverShift.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('a shift is on only when presence is exactly online', () => {
  assert.equal(isOnShift(null), false)
  assert.equal(isOnShift(undefined), false)
  assert.equal(isOnShift({}), false)
  assert.equal(isOnShift({ online: false }), false)
  assert.equal(isOnShift({ online: null }), false)
  assert.equal(isOnShift({ online: 'false' }), false)
  assert.equal(isOnShift({ online: true }), true)
})

test('stopped and unapproved drivers do not receive offers', () => {
  assert.equal(canReceiveOffers({ onShift: false, approved: true }), false)
  assert.equal(canReceiveOffers({ onShift: true, approved: false }), false)
  assert.equal(canReceiveOffers({ onShift: true, approved: true }), true)
})

test('start and stop write presence and do not cancel the active trip', () => {
  const trip = { id: 'trip-1', status: 'in_progress', fare_cents: 2400 }
  const started = startShift()
  assert.deepEqual(started.presence, { online: true })
  assert.equal(started.cancelsTrip, false)
  assert.equal('trip' in started, false)

  const stopped = stopShift({ trip })
  assert.deepEqual(stopped.presence, { online: false })
  assert.equal(stopped.cancelsTrip, false)
  assert.equal(stopped.trip, trip)
  assert.equal(stopped.trip.status, 'in_progress')
  assert.deepEqual(Object.keys(stopped.presence), ['online'])
})

test('an offer card is hidden off the clock and during an active trip', () => {
  const offer = { id: 'offer-1', status: 'searching' }
  const trip = { id: 'trip-1', status: 'accepted' }
  assert.equal(visibleOffer({ onShift: false, offer, activeTrip: null }), null)
  assert.equal(visibleOffer({ onShift: true, offer, activeTrip: trip }), null)
  assert.equal(visibleOffer({ onShift: true, offer: null, activeTrip: null }), null)
  assert.equal(visibleOffer({ onShift: true, offer, activeTrip: null }), offer)
})

test('a location tick does not include the shift flag unless the caller sets it', () => {
  assert.deepEqual(locationFields({ lat: 34.68, lng: -82.84, heading: 12 }), {
    lat: 34.68,
    lng: -82.84,
    heading: 12,
  })
  assert.equal('online' in locationFields({ lat: 1, lng: 2 }), false)
  assert.equal(locationFields({ lat: 1, lng: 2, online: false }).online, false)
})

test('the website driver screen does not auto-start a shift or cancel a trip from stop', () => {
  const home = readFileSync(path.join(root, 'src/screens/DriverHome.jsx'), 'utf8')
  const track = readFileSync(path.join(root, 'src/lib/driverTrack.js'), 'utf8')
  assert.match(home, /isOnShift/)
  assert.match(home, /stopShift\(/)
  assert.match(home, /startShift\(/)
  assert.doesNotMatch(home, /setDriverOnline\(driverId,\s*true\)/)
  assert.doesNotMatch(home, /setDriverOnline\(driverId,\s*false\)/)
  assert.match(home, /setDriverOnline\(driverId,\s*change\.presence\.online\)/)
  assert.doesNotMatch(home, /publishDriverLocation\([\s\S]{0,180}online/)
  assert.match(home, /visibleOffer\(/)
  assert.doesNotMatch(track, /online = true/)
  assert.match(track, /locationFields/)
})
