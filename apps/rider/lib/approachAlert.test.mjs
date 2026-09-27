import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPROACH_CLOSE_FT,
  APPROACH_DECREASE_FT,
  APPROACH_HERE_FT,
  APPROACH_NEAR_FT,
  approachAttention,
  approachStage,
  approachStatusLine,
  formatApproachDistance,
  formatApproachFeet,
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
  assert.equal(formatApproachDistance(0)?.primary, 'Driver 0 ft away')
  assert.equal(formatApproachDistance(-1), null)
  assert.equal(formatApproachDistance(null), null)
  assert.equal(formatApproachDistance(undefined), null)
  assert.equal(formatApproachDistance(Number.NaN), null)
  assert.equal(formatApproachDistance(Number.POSITIVE_INFINITY), null)
  // BUG?: feet and meters are rounded separately, so the two lines can disagree.
  // 1.4 m is 5 ft, and 5 ft is about 1.5 m, but the secondary still says 1 m.
  const split = formatApproachDistance(1.4)
  assert.equal(split?.feet, 5)
  assert.equal(split?.meters, 1)
  assert.equal(split?.primary, 'Driver 5 ft away')
  assert.equal(split?.secondary, '1 m')
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
  assert.equal(approachStage(null), null)
  assert.equal(approachStage(undefined), null)
  assert.equal(approachStage(Number.NaN), null)
  assert.equal(approachStage(Number.POSITIVE_INFINITY), null)
  assert.equal(approachStage(Number.NEGATIVE_INFINITY), null)
  // Whole feet match the label: 100.4 displays as 100 ft (here), 100.5 as 101 (close).
  assert.equal(approachStage(100.4), 'here')
  assert.equal(approachStage(100.5), 'close')
  assert.equal(approachStage(200.4), 'close')
  assert.equal(approachStage(200.5), 'near')
  assert.equal(approachStage(500.4), 'near')
  assert.equal(approachStage(500.5), 'far')
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
  assert.equal(approachAttention({ previousFeet: 100, feet: null }), null)
  assert.equal(approachAttention({ previousFeet: 100, feet: undefined }), null)
  assert.equal(approachAttention({ previousFeet: 100, feet: Number.POSITIVE_INFINITY }), null)
  assert.equal(approachAttention({ previousFeet: Number.NaN, feet: 40 })?.decreasing, false)
  assert.equal(approachAttention({ previousFeet: Number.NaN, feet: 40 })?.hapticReason, 'stage')
  assert.equal(approachAttention({ previousFeet: -40, feet: 300 })?.decreasing, false)
  assert.equal(approachAttention({ previousFeet: -40, feet: 300 })?.hapticReason, 'stage')
})

test('approach statuses are accepted, arriving, and arrived', () => {
  assert.equal(isApproachStatus('accepted'), true)
  assert.equal(isApproachStatus('arriving'), true)
  assert.equal(isApproachStatus('arrived'), true)
  assert.equal(isApproachStatus('in_progress'), false)
  assert.equal(isApproachStatus('searching'), false)
  assert.equal(approachStatusLine('near', true), 'Getting closer · nearby')
  assert.equal(approachStatusLine('here', true), 'Right here · nearby')
  assert.equal(approachStatusLine('far', false), 'On the way · nearby')
  assert.equal(approachStatusLine(null, false), 'Locating · nearby')
  assert.equal(approachStatusLine(null, true), 'Locating · nearby')
})

test('far, near, and here boundaries stay put when distance rises or falls', () => {
  const cuts = [0, APPROACH_HERE_FT, APPROACH_HERE_FT + 1, APPROACH_CLOSE_FT, APPROACH_CLOSE_FT + 1, APPROACH_NEAR_FT, APPROACH_NEAR_FT + 1]
  for (const feet of cuts) {
    const expected = approachStage(feet)
    const falling = approachAttention({ previousFeet: feet + 80, feet })
    const rising = approachAttention({ previousFeet: Math.max(0, feet - 80), feet })
    assert.equal(falling?.stage, expected, `falling into ${feet}`)
    assert.equal(rising?.stage, expected, `rising into ${feet}`)
    assert.equal(falling?.decreasing, true)
    assert.equal(rising?.decreasing, false)
  }
  assert.equal(approachStage(APPROACH_HERE_FT), 'here')
  assert.equal(approachStage(APPROACH_CLOSE_FT), 'close')
  assert.equal(approachStage(APPROACH_NEAR_FT), 'near')
  assert.equal(approachStage(APPROACH_NEAR_FT + 1), 'far')
})

test('decreasing and increasing distance use a 25 ft whole-foot step', () => {
  const exact = approachAttention({ previousFeet: 400, feet: 400 - APPROACH_DECREASE_FT })
  assert.equal(exact?.decreasing, true)
  assert.equal(exact?.hapticReason, 'closing')

  const under = approachAttention({ previousFeet: 400, feet: 400 - APPROACH_DECREASE_FT + 1 })
  assert.equal(under?.decreasing, false)
  assert.equal(under?.haptic, null)

  const opening = approachAttention({ previousFeet: 300, feet: 340 })
  assert.equal(opening?.decreasing, false)
  assert.equal(opening?.stage, 'near')
  assert.equal(opening?.pulseMode, 'steady')
  assert.equal(opening?.haptic, null)

  const leftHere = approachAttention({ previousFeet: 80, feet: 80 + APPROACH_DECREASE_FT })
  assert.equal(leftHere?.decreasing, false)
  assert.equal(leftHere?.stage, 'close')
  assert.equal(leftHere?.haptic, null)

  // 100.4 → 75.4 displays as 100 → 75, a 25 ft drop.
  const roundedDrop = approachAttention({ previousFeet: 100.4, feet: 75.4 })
  assert.equal(roundedDrop?.stage, 'here')
  assert.equal(roundedDrop?.decreasing, true)
  // 100.2 → 75.6 displays as 100 → 76, a 24 ft drop.
  const roundedHold = approachAttention({ previousFeet: 100.2, feet: 75.6 })
  assert.equal(roundedHold?.decreasing, false)
})

test('previousStage holds far, near, and here across outward jitter', () => {
  let stage = null
  let prev = null
  const seen = []
  for (const feet of [100, 110, 118, 124, 125, 126]) {
    const attention = approachAttention({ previousFeet: prev, feet, previousStage: stage })
    seen.push(attention?.stage)
    prev = feet
    stage = attention?.stage ?? null
  }
  assert.deepEqual(seen, ['here', 'here', 'here', 'here', 'here', 'close'])

  const heldNear = approachAttention({
    previousFeet: APPROACH_NEAR_FT,
    feet: APPROACH_NEAR_FT + APPROACH_DECREASE_FT,
    previousStage: 'near',
  })
  assert.equal(heldNear?.stage, 'near')
  assert.equal(heldNear?.pulseMode, 'steady')
  assert.equal(heldNear?.washPeak, 0.24)
  assert.equal(heldNear?.haptic, null)

  const releaseNear = approachAttention({
    previousFeet: APPROACH_NEAR_FT + APPROACH_DECREASE_FT,
    feet: APPROACH_NEAR_FT + APPROACH_DECREASE_FT + 1,
    previousStage: 'near',
  })
  assert.equal(releaseNear?.stage, 'far')
  assert.equal(releaseNear?.pulseMode, 'off')
  assert.equal(releaseNear?.decreasing, false)

  const heldClose = approachAttention({
    previousFeet: APPROACH_CLOSE_FT,
    feet: APPROACH_CLOSE_FT + APPROACH_DECREASE_FT,
    previousStage: 'close',
  })
  assert.equal(heldClose?.stage, 'close')

  const arrive = approachAttention({
    previousFeet: APPROACH_CLOSE_FT,
    feet: APPROACH_HERE_FT,
    previousStage: 'close',
  })
  assert.equal(arrive?.stage, 'here')
  assert.equal(arrive?.decreasing, true)
  assert.equal(arrive?.haptic, 'heavy')
  assert.equal(arrive?.hapticReason, 'stage')

  const firstFar = approachAttention({ previousFeet: null, feet: 800, previousStage: null })
  assert.equal(firstFar?.haptic, null)
  assert.equal(firstFar?.pulseMode, 'off')
  assert.equal(firstFar?.decreasing, false)
})

test('status line always includes feet or nearby', () => {
  assert.equal(formatApproachFeet(null), 'nearby')
  assert.equal(formatApproachFeet(undefined), 'nearby')
  assert.equal(formatApproachFeet(Number.NaN), 'nearby')
  assert.equal(formatApproachFeet(Number.POSITIVE_INFINITY), 'nearby')
  assert.equal(formatApproachFeet(-3), 'nearby')
  assert.equal(formatApproachFeet(0), '0 ft')
  assert.equal(formatApproachFeet(1), '1 ft')
  assert.equal(formatApproachFeet(100.5), '101 ft')
  assert.equal(formatApproachFeet(5280), '5,280 ft')

  const stages = ['far', 'near', 'close', 'here', null]
  for (const stage of stages) {
    for (const decreasing of [false, true]) {
      const missing = approachStatusLine(stage, decreasing)
      assert.match(missing, /ft|nearby/i)
      const withFeet = approachStatusLine(stage, decreasing, 240)
      assert.match(withFeet, /240 ft/)
      const unusable = approachStatusLine(stage, decreasing, Number.NaN)
      assert.match(unusable, /nearby/i)
      assert.doesNotMatch(unusable, /\d/)
    }
  }
  assert.equal(approachStatusLine('near', true, 240), 'Getting closer · 240 ft')
  assert.equal(approachStatusLine('here', true, 40), 'Right here · 40 ft')
  assert.equal(approachStatusLine('here', false, 0), 'Right here · 0 ft')
  assert.equal(approachStatusLine('close', false, 150), 'Very close · 150 ft')
  assert.equal(approachStatusLine('far', false, 1900), 'On the way · 1,900 ft')
  assert.equal(approachStatusLine('near', false, 300), 'Nearby · 300 ft')
  assert.equal(approachStatusLine('near', false), 'Nearby')
  assert.equal(approachStatusLine('far', true, null), 'Getting closer · nearby')
  assert.equal(approachStatusLine(null, true, 12), 'Locating · 12 ft')
})

test('a 1 ft boundary wobble re-fires the stage haptic without previousStage', () => {
  // BUG?: previousFeet alone does not hold the boundary. 100 → 101 leaves "here",
  // and 101 → 100 fires another heavy haptic. Pass previousStage (the hook does)
  // to keep the closer stage through jitter smaller than APPROACH_DECREASE_FT.
  const outward = approachAttention({ previousFeet: 100, feet: 101 })
  assert.equal(outward?.stage, 'close')
  assert.equal(outward?.decreasing, false)
  assert.equal(outward?.haptic, null)

  const inward = approachAttention({ previousFeet: 101, feet: 100 })
  assert.equal(inward?.stage, 'here')
  assert.equal(inward?.decreasing, false)
  assert.equal(inward?.haptic, 'heavy')
  assert.equal(inward?.hapticReason, 'stage')
})
