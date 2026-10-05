import assert from 'node:assert/strict'
import test from 'node:test'
import {
  playRideChime,
  playRideRequestAlert,
  pulseRideHaptic,
  shouldAlertForRide,
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

test('playRideChime no-ops safely when Audio is missing', async () => {
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  try {
    // Drop HTMLAudioElement so the file fallback cannot construct a player.
    Reflect.deleteProperty(globalThis, 'Audio')
    if (typeof Audio !== 'undefined') {
      Object.defineProperty(globalThis, 'Audio', {
        configurable: true,
        writable: true,
        value: undefined,
      })
    }
    // Blank window so the Web Audio synth path cannot play and hide a missing Audio.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {},
    })
    assert.equal(typeof Audio, 'undefined')

    assert.equal(await playRideChime(), false)
    assert.equal(await playRideChime(), false)

    await assert.doesNotReject(async () => {
      await playRideRequestAlert()
    })
  } finally {
    if (audioDescriptor) Object.defineProperty(globalThis, 'Audio', audioDescriptor)
    else Reflect.deleteProperty(globalThis, 'Audio')
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
