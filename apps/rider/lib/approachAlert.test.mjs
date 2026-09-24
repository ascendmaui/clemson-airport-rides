import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPROACH_DECREASE_FT,
  approachAttention,
  approachStage,
  approachStatusLine,
  formatApproachDistance,
  haversineMeters,
  isApproachStatus,
} from './approachAlert.ts'

test('haversine is zero at one point and about 111m per 0.001 degree', () => {
  assert.equal(haversineMeters(34.68, -82.84, 34.68, -82.84), 0)
  const north = haversineMeters(0, 0, 0.001, 0)
  assert.ok(north != null && north > 100 && north < 120)
  assert.equal(haversineMeters(Number.NaN, 0, 0, 0), null)
})

test('formats a live readout in feet with meters secondary', () => {
  const reading = formatApproachDistance(73.152)
  assert.ok(reading)
  assert.equal(reading.feet, 240)
  assert.equal(reading.meters, 73)
  assert.equal(reading.primary, 'Driver 240 ft away')
  assert.equal(reading.secondary, '73 m')
  assert.equal(formatApproachDistance(1609.344)?.primary, 'Driver 5,280 ft away')
  assert.equal(formatApproachDistance(-1), null)
  assert.equal(formatApproachDistance(null), null)
})

test('stages sit on 100, 200, and 500 foot thresholds', () => {
  assert.equal(approachStage(0), 'here')
  assert.equal(approachStage(100), 'here')
  assert.equal(approachStage(101), 'close')
  assert.equal(approachStage(200), 'close')
  assert.equal(approachStage(201), 'near')
  assert.equal(approachStage(500), 'near')
  assert.equal(approachStage(501), 'far')
  assert.equal(approachStage(-1), null)
})

test('pulses inside the thresholds and when the driver is closing in', () => {
  const entered = approachAttention({ previousFeet: 640, feet: 480 })
  assert.equal(entered?.stage, 'near')
  assert.equal(entered?.pulseMode, 'steady')
  assert.equal(entered?.haptic, 'light')
  assert.equal(entered?.hapticReason, 'stage')

  const closingInside = approachAttention({ previousFeet: 450, feet: 450 - APPROACH_DECREASE_FT })
  assert.equal(closingInside?.decreasing, true)
  assert.equal(closingInside?.pulseMode, 'steady')
  assert.equal(closingInside?.hapticReason, 'closing')

  const here = approachAttention({ previousFeet: 140, feet: 90 })
  assert.equal(here?.stage, 'here')
  assert.equal(here?.haptic, 'heavy')
  assert.ok((here?.washPeak ?? 0) <= 0.4)

  const hold = approachAttention({ previousFeet: 90, feet: 88 })
  assert.equal(hold?.decreasing, false)
  assert.equal(hold?.pulseMode, 'steady')
  assert.equal(hold?.haptic, null)

  const farClosing = approachAttention({ previousFeet: 2000, feet: 1900 })
  assert.equal(farClosing?.stage, 'far')
  assert.equal(farClosing?.pulseMode, 'burst')
  assert.equal(farClosing?.hapticReason, 'closing')

  const farStill = approachAttention({ previousFeet: 2000, feet: 1990 })
  assert.equal(farStill?.pulseMode, 'off')
  assert.equal(farStill?.haptic, null)

  const firstFixClose = approachAttention({ previousFeet: null, feet: 80 })
  assert.equal(firstFixClose?.hapticReason, 'stage')
  assert.equal(firstFixClose?.haptic, 'heavy')

  assert.equal(approachAttention({ previousFeet: null, feet: Number.NaN }), null)
})

test('approach statuses are accepted, arriving, and arrived', () => {
  assert.equal(isApproachStatus('accepted'), true)
  assert.equal(isApproachStatus('arriving'), true)
  assert.equal(isApproachStatus('arrived'), true)
  assert.equal(isApproachStatus('in_progress'), false)
  assert.equal(isApproachStatus('searching'), false)
  assert.equal(approachStatusLine('near', true), 'Getting closer')
  assert.equal(approachStatusLine('here', true), 'Right here')
  assert.equal(approachStatusLine('far', false), 'On the way')
  assert.equal(approachStatusLine(null, false), 'Locating')
})
