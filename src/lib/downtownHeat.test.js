import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAMPUS_ANCHORS,
  DOWNTOWN_CENTER,
  DOWNTOWN_VENUES,
  downtownNow,
  heatColor,
  typicalDemandPoints,
} from './downtownHeat.js'

function fixedDate(dayOfWeek, hour, minute = 0) {
  // 2026-03-01 was a Sunday (day 0)
  // day 0: March 1, 2026
  // day 1: March 2, 2026 (Mon)
  // day 2: March 3, 2026 (Tue)
  // day 3: March 4, 2026 (Wed)
  // day 4: March 5, 2026 (Thu)
  // day 5: March 6, 2026 (Fri)
  // day 6: March 7, 2026 (Sat)
  const d = new Date(2026, 2, 1 + dayOfWeek, hour, minute, 0, 0)
  assert.equal(d.getDay(), dayOfWeek, 'Day of week matches')
  assert.equal(d.getHours(), hour, 'Hour matches')
  return d
}

test('DOWNTOWN_CENTER has valid Clemson downtown coordinates', () => {
  assert.ok(Array.isArray(DOWNTOWN_CENTER))
  assert.equal(DOWNTOWN_CENTER.length, 2)
  const [lat, lng] = DOWNTOWN_CENTER
  assert.ok(lat > 34.68 && lat < 34.69, `lat ${lat} in range`)
  assert.ok(lng > -82.84 && lng < -82.83, `lng ${lng} in range`)
})

test('DOWNTOWN_VENUES and CAMPUS_ANCHORS catalog integrity', () => {
  assert.equal(DOWNTOWN_VENUES.length, 4)
  assert.equal(CAMPUS_ANCHORS.length, 5)

  for (const v of DOWNTOWN_VENUES) {
    assert.ok(v.id && typeof v.id === 'string')
    assert.ok(v.name && typeof v.name === 'string')
    assert.ok(v.lat > 34 && v.lat < 35)
    assert.ok(v.lng < -82 && v.lng > -83)
    assert.ok(v.radius > 0)
    assert.ok(['bar', 'late'].includes(v.curve))
  }

  for (const a of CAMPUS_ANCHORS) {
    assert.ok(a.id && typeof a.id === 'string')
    assert.ok(a.name && typeof a.name === 'string')
    assert.ok(a.lat > 34 && a.lat < 35)
    assert.ok(a.lng < -82 && a.lng > -83)
    assert.ok(a.radius > 0)
    assert.ok(['gameday', 'campus', 'dorm', 'late'].includes(a.curve))
  }

  const ids = new Set([...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS].map((x) => x.id))
  assert.equal(ids.size, 9, 'All 9 venue/anchor IDs must be unique')
})

test('heatColor maps intensity thresholds accurately', () => {
  assert.equal(heatColor(1.0), '#F56600', '1.0 is peak orange')
  assert.equal(heatColor(0.75), '#F56600', '0.75 threshold is orange')
  assert.equal(heatColor(0.749), '#C45A12', '0.749 is amber/rust')
  assert.equal(heatColor(0.45), '#C45A12', '0.45 threshold is amber/rust')
  assert.equal(heatColor(0.449), '#522D80', '0.449 is purple')
  assert.equal(heatColor(0.2), '#522D80', '0.2 is purple')
  assert.equal(heatColor(0.0), '#522D80', '0.0 is purple')
})

test('downtownNow calculates peak weekend intensity and Packed label', () => {
  // Friday at 23:00 (11 PM) -> Peak bar hour
  const fridayPeak = fixedDate(5, 23)
  const result = downtownNow(fridayPeak)

  assert.equal(result.day, 5)
  assert.equal(result.hour, 23)
  assert.equal(result.spots.length, 4)
  assert.equal(result.label, 'Packed')
  assert.ok(result.avg >= 0.75, `avg ${result.avg} >= 0.75`)

  const collegeAve = result.spots.find((s) => s.id === 'college-ave-core')
  assert.equal(collegeAve.intensity, 1)

  const keithSt = result.spots.find((s) => s.id === 'keith-st')
  assert.equal(keithSt.intensity, 0.85)
})

test('downtownNow calculates weekday morning lull and Quiet label', () => {
  // Tuesday at 10:00 AM -> Quiet
  const tuesdayMorning = fixedDate(2, 10)
  const result = downtownNow(tuesdayMorning)

  assert.equal(result.day, 2)
  assert.equal(result.hour, 10)
  assert.equal(result.label, 'Quiet')
  assert.ok(result.avg < 0.22, `avg ${result.avg} < 0.22`)

  for (const spot of result.spots) {
    assert.ok(spot.intensity < 0.1, `Spot ${spot.id} intensity ${spot.intensity} < 0.1`)
  }
})

test('downtownNow calculates Thursday evening Busy and Picking up labels', () => {
  // Thursday at 22:00 -> Busy
  const thuNight = fixedDate(4, 22)
  const busyResult = downtownNow(thuNight)
  assert.equal(busyResult.label, 'Busy')
  assert.ok(busyResult.avg >= 0.45 && busyResult.avg < 0.75)

  // Friday at 17:00 (5 PM) -> Picking up
  const friHappyHour = fixedDate(5, 17)
  const pickingUpResult = downtownNow(friHappyHour)
  assert.equal(pickingUpResult.label, 'Picking up')
  assert.ok(pickingUpResult.avg >= 0.22 && pickingUpResult.avg < 0.45)
})

test('downtownNow falls back cleanly when invoked with no arguments', () => {
  const result = downtownNow()
  assert.ok(typeof result.day === 'number')
  assert.ok(typeof result.hour === 'number')
  assert.ok(typeof result.avg === 'number')
  assert.ok(['Quiet', 'Picking up', 'Busy', 'Packed'].includes(result.label))
  assert.equal(result.spots.length, 4)
})

test('typicalDemandPoints includes campus anchors by default and respects flag', () => {
  const satGameday = fixedDate(6, 14) // Saturday 2:00 PM

  const withCampus = typicalDemandPoints(satGameday, { includeCampus: true })
  assert.equal(withCampus.length, 9, 'Includes 4 venues + 5 campus anchors')

  const withoutCampus = typicalDemandPoints(satGameday, { includeCampus: false })
  assert.equal(withoutCampus.length, 4, 'Includes 4 venues only')

  const defaultCampus = typicalDemandPoints(satGameday)
  assert.equal(defaultCampus.length, 9, 'Default includes campus anchors')
})

test('typicalDemandPoints computes weights with minimum floor and gameday surge', () => {
  const satGameday = fixedDate(6, 14) // Saturday 2:00 PM gameday
  const points = typicalDemandPoints(satGameday)

  for (const pt of points) {
    assert.ok(pt.lat > 34 && pt.lat < 35)
    assert.ok(pt.lng < -82 && pt.lng > -83)
    assert.equal(pt.source, 'typical')
    assert.ok(pt.id && pt.name)
    assert.ok(pt.weight >= 0.6, 'Minimum weight floor is 0.15 * 4 = 0.6')
  }

  const stadium = points.find((p) => p.id === 'memorial-stadium')
  assert.ok(stadium, 'Memorial stadium present')
  // Saturday 14:00 gamedayCurve is 0.95 -> weight = 0.95 * 4 = 3.8
  assert.ok(Math.abs(stadium.weight - 3.8) < 1e-6, `Stadium weight expected 3.8, got ${stadium.weight}`)
})

test('typicalDemandPoints dorm curve reflects morning class commute vs night return', () => {
  const weekdayMorning = fixedDate(1, 8) // Monday 8:00 AM
  const pointsMorning = typicalDemandPoints(weekdayMorning)
  const holmesMorning = pointsMorning.find((p) => p.id === 'holmes-hall')
  // Weekday 8:00 AM dormCurve is 0.55 -> weight = 0.55 * 4 = 2.2
  assert.ok(Math.abs(holmesMorning.weight - 2.2) < 1e-6)

  const weekdayNight = fixedDate(1, 22) // Monday 10:00 PM
  const pointsNight = typicalDemandPoints(weekdayNight)
  const holmesNight = pointsNight.find((p) => p.id === 'holmes-hall')
  // Weekday 22:00 dormCurve is 0.40 -> weight = 0.40 * 4 = 1.6
  assert.ok(Math.abs(holmesNight.weight - 1.6) < 1e-6)
})
