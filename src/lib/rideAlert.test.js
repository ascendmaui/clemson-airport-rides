import assert from 'node:assert/strict'
import test from 'node:test'
import {
  playRideChime,
  playRideRequestAlert,
  pulseRideHaptic,
  shouldAlertForRide,
  shouldPlayDriverOfferChime,
} from './rideAlert.js'

test('shouldAlertForRide respects explicit notification toggle', () => {
  assert.equal(shouldAlertForRide({ ride: false }), false, 'Muted when ride toggle is false')
  assert.equal(shouldAlertForRide({ ride: true }), true, 'Active when ride toggle is true')
  assert.equal(shouldAlertForRide({}), true, 'Defaults to active when omitted')
  assert.equal(shouldAlertForRide(null), true, 'Defaults to active when prefs is null')
})

test('shouldAlertForRide respects quiet hours and DND settings', () => {
  const dndPrefs = {
    ride: true,
    quiet: { dnd: true },
  }
  assert.equal(shouldAlertForRide(dndPrefs), false, 'Muted during DND')

  const normalPrefs = {
    ride: true,
    quiet: { dnd: false, scheduleEnabled: false },
  }
  assert.equal(shouldAlertForRide(normalPrefs), true, 'Active when schedule is off')
})

test('shouldPlayDriverOfferChime stays in-app and respects quiet and DND', () => {
  assert.equal(shouldPlayDriverOfferChime({ ride: true }), true)
  assert.equal(shouldPlayDriverOfferChime({ ride: false }), false)
  assert.equal(shouldPlayDriverOfferChime({ ride: true, dndNewRequestTones: true }), false)
  assert.equal(shouldPlayDriverOfferChime({ ride: true, quiet: { dnd: true } }), false)
})

test('pulseRideHaptic gracefully handles headless / node environments', () => {
  // In Node environment without navigator.vibrate, pulseRideHaptic must not throw
  assert.doesNotThrow(() => {
    pulseRideHaptic()
  })
})

test('pulseRideHaptic triggers navigator.vibrate when available', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let pattern = null

  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        vibrate: (p) => {
          pattern = p
          return true
        },
      },
      configurable: true,
      writable: true,
    })

    pulseRideHaptic()
    assert.deepEqual(pattern, [70, 40, 120], 'Expected 70-40-120 vibrate pattern')
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor)
    } else {
      delete globalThis.navigator
    }
  }
})

test('playRideChime and playRideRequestAlert complete cleanly without audio hardware', async () => {
  const chimeResult = await playRideChime()
  assert.equal(typeof chimeResult === 'boolean', true)

  await assert.doesNotReject(async () => {
    await playRideRequestAlert()
  })
})
