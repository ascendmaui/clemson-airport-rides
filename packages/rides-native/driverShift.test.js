import assert from 'node:assert/strict'
import test from 'node:test'
import { desiredShift, lookingForRides, onlineAfterLeave, quietSwitchOn, readShift, showOfferInTopBar } from './driverShift.js'

test('quietSwitchOn accepts on values and clears string off values', () => {
  for (const value of [true, 1, 'true', 'TRUE', ' yes ', 'on', '1']) {
    assert.equal(quietSwitchOn(value), true, String(value))
  }
  for (const value of [false, 0, '', 'false', 'no', 'off', '0', null, undefined, '  ', []]) {
    assert.equal(quietSwitchOn(value), false, String(value))
  }
})

test('desiredShift writes online and off-the-clock together', () => {
  assert.deepEqual(desiredShift(true), { available: true, online: true, dnd: false })
  assert.deepEqual(desiredShift(false), { available: false, online: false, dnd: true })
})

test('readShift lets off the clock win over a stuck online flag', () => {
  assert.deepEqual(readShift({ online: true, dnd: false }), {
    available: true,
    dnd: false,
    reconcile: false,
  })
  assert.deepEqual(readShift({ online: false, dnd: false }), {
    available: false,
    dnd: false,
    reconcile: false,
  })
  assert.deepEqual(readShift({ online: true, dnd: 'false' }), {
    available: true,
    dnd: false,
    reconcile: false,
  })
  assert.deepEqual(readShift({ online: true, dnd: true }), {
    available: false,
    dnd: true,
    reconcile: true,
  })
  assert.deepEqual(readShift({ online: 'false', dnd: 'no' }), {
    available: false,
    dnd: false,
    reconcile: false,
  })
  assert.deepEqual(readShift({}), { available: false, dnd: false, reconcile: false })
})

test('leaving a screen or the app does not clear an online shift', () => {
  assert.equal(onlineAfterLeave(true), true)
  assert.equal(onlineAfterLeave(false), false)
})

test('offer top bar shows off the driver home and while the app is not active', () => {
  assert.equal(showOfferInTopBar({ online: true, hasOffer: true, onDriverHome: false, appActive: true }), true)
  assert.equal(showOfferInTopBar({ online: true, hasOffer: true, onDriverHome: true, appActive: false }), true)
  assert.equal(showOfferInTopBar({ online: true, hasOffer: true, onDriverHome: true, appActive: true }), false)
  assert.equal(showOfferInTopBar({ online: false, hasOffer: true, onDriverHome: false }), false)
  assert.equal(showOfferInTopBar({ online: true, hasOffer: false, onDriverHome: false }), false)
})

test('lookingForRides runs only while on the clock without an active trip', () => {
  assert.equal(lookingForRides({ available: true, onTrip: false }), true)
  assert.equal(lookingForRides({ available: true, onTrip: true }), false)
  assert.equal(lookingForRides({ available: false, onTrip: false }), false)
  assert.equal(lookingForRides(), false)
})
