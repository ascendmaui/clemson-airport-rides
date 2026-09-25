import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAMPUS_ANCHORS,
  DOWNTOWN_VENUES,
  downtownNow,
  heatColor,
  previewDate,
  resolveDemandRange,
  typicalSpots,
} from './heat.js'

const DAY_MS = 864e5
const PURPLE = '#522D80'
const RUST = '#C45A12'
const ORANGE = '#F56600'
const LABELS = ['Quiet', 'Picking up', 'Busy', 'Packed']

/** Local time. Month is 1–12. Never uses Date.now(). */
function at(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  return new Date(year, month - 1, day, hour, minute, second, ms)
}

function near(actual, expected, message) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9,
    message || `expected ${expected}, got ${actual}`,
  )
}

function byId(spots, id) {
  const spot = spots.find((entry) => entry.id === id)
  assert.ok(spot, `missing spot ${id}`)
  return spot
}

test('downtown venues and campus anchors keep their catalog shape', () => {
  assert.deepEqual(
    DOWNTOWN_VENUES.map(({ id, name, curve }) => ({ id, name, curve })),
    [
      { id: 'college-ave-core', name: 'College Ave', curve: 'bar' },
      { id: 'tiger-town', name: 'Tiger Town Tavern', curve: 'bar' },
      { id: 'study-hall', name: 'The Study Hall', curve: 'bar' },
      { id: 'keith-st', name: 'Keith St pickup', curve: 'late' },
    ],
  )
  assert.deepEqual(
    CAMPUS_ANCHORS.map(({ id, name, curve }) => ({ id, name, curve })),
    [
      { id: 'memorial-stadium', name: 'Memorial Stadium', curve: 'gameday' },
      { id: 'core-campus', name: 'Core campus', curve: 'campus' },
      { id: 'holmes-hall', name: 'Holmes Hall area', curve: 'dorm' },
      { id: 'shoeboxes', name: 'Shoeboxes / West Campus', curve: 'dorm' },
      { id: 'fraternity-row', name: 'Fraternity Row', curve: 'late' },
    ],
  )

  const ids = new Set()
  for (const venue of [...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS]) {
    assert.equal(typeof venue.id, 'string')
    assert.equal(typeof venue.name, 'string')
    assert.equal(typeof venue.curve, 'string')
    assert.ok(venue.lat > 34.67 && venue.lat < 34.69, venue.id)
    assert.ok(venue.lng < -82.83 && venue.lng > -82.85, venue.id)
    assert.ok(venue.radius > 0, venue.id)
    assert.equal(ids.has(venue.id), false)
    ids.add(venue.id)
    assert.deepEqual(Object.keys(venue).sort(), ['curve', 'id', 'lat', 'lng', 'name', 'radius'])
  }

  assert.deepEqual(
    DOWNTOWN_VENUES.map(({ lat, lng, radius }) => [lat, lng, radius]),
    [
      [34.6839, -82.8366, 220],
      [34.6844, -82.8362, 90],
      [34.6835, -82.8368, 80],
      [34.6848, -82.8374, 70],
    ],
  )
  assert.deepEqual(
    CAMPUS_ANCHORS.map(({ lat, lng, radius }) => [lat, lng, radius]),
    [
      [34.6788, -82.843, 280],
      [34.6784, -82.8397, 200],
      [34.6762, -82.8348, 120],
      [34.6755, -82.8475, 140],
      [34.6821, -82.8418, 110],
    ],
  )
})

test('heat color switches at 0.45 and 0.75', () => {
  for (const intensity of [-Infinity, -1, -0.01, 0, 0.22, 0.449]) {
    assert.equal(heatColor(intensity), PURPLE, String(intensity))
  }
  for (const intensity of [0.45, 0.5, 0.74, 0.749]) {
    assert.equal(heatColor(intensity), RUST, String(intensity))
  }
  for (const intensity of [0.75, 0.9, 1, 1.5, Infinity]) {
    assert.equal(heatColor(intensity), ORANGE, String(intensity))
  }
})

test('heat color treats NaN, undefined, and null as the quiet purple', () => {
  assert.equal(heatColor(NaN), PURPLE)
  assert.equal(heatColor(undefined), PURPLE)
  assert.equal(heatColor(null), PURPLE)
})

test('downtown snapshot echoes the clock and the venue catalog', () => {
  const when = at(2026, 9, 24, 16, 5, 1, 2)
  const snap = downtownNow(when)
  assert.deepEqual(Object.keys(snap).sort(), ['avg', 'day', 'hour', 'label', 'spots'])
  assert.equal(snap.day, 4)
  assert.equal(snap.hour, 16)
  assert.equal(snap.spots.length, DOWNTOWN_VENUES.length)
  assert.deepEqual(
    snap.spots.map((spot) => spot.id),
    DOWNTOWN_VENUES.map((venue) => venue.id),
  )
  snap.spots.forEach((spot, index) => {
    const venue = DOWNTOWN_VENUES[index]
    assert.notEqual(spot, venue)
    assert.equal(spot.name, venue.name)
    assert.equal(spot.lat, venue.lat)
    assert.equal(spot.lng, venue.lng)
    assert.equal(spot.radius, venue.radius)
    assert.equal(spot.curve, venue.curve)
    assert.deepEqual(Object.keys(spot).sort(), ['curve', 'id', 'intensity', 'lat', 'lng', 'name', 'radius'])
    assert.ok(spot.intensity >= 0 && spot.intensity <= 1)
  })
  near(snap.avg, snap.spots.reduce((sum, spot) => sum + spot.intensity, 0) / snap.spots.length)
  assert.ok(LABELS.includes(snap.label))
  assert.equal(DOWNTOWN_VENUES[0].intensity, undefined)
})

test('downtown labels follow the average bands', () => {
  // Thresholds: Packed >= 0.75, Busy >= 0.45, Picking up >= 0.22, otherwise Quiet.
  const rows = [
    [2026, 9, 25, 23, 'Packed', 0.9625],
    [2026, 9, 25, 21, 'Packed', 0.9025],
    [2026, 9, 26, 23, 'Packed', 0.9625],
    [2026, 9, 24, 23, 'Busy', 0.6125],
    [2026, 9, 24, 21, 'Busy', 0.5225],
    [2026, 9, 25, 20, 'Busy', 0.495],
    [2026, 9, 26, 20, 'Busy', 0.495],
    [2026, 9, 24, 20, 'Picking up', 0.315],
    [2026, 9, 25, 16, 'Picking up', 0.252],
    [2026, 9, 23, 23, 'Picking up', 0.3275],
    [2026, 9, 23, 21, 'Picking up', 0.2975],
    [2026, 9, 20, 23, 'Picking up', 0.3275],
    [2026, 9, 23, 12, 'Quiet', 0.036],
    [2026, 9, 23, 0, 'Quiet', 0.1175],
    [2026, 9, 25, 15, 'Quiet', 0.072],
    [2026, 9, 20, 20, 'Quiet', 0.162],
    [2026, 9, 24, 16, 'Quiet', 0.162],
    [2026, 9, 20, 8, 'Quiet', 0.036],
  ]
  for (const [year, month, day, hour, label, avg] of rows) {
    const snap = downtownNow(at(year, month, day, hour, 30))
    assert.equal(snap.label, label, `${year}-${month}-${day} ${hour}:00`)
    near(snap.avg, avg, `${year}-${month}-${day} ${hour}:00 avg expected ${avg}, got ${snap.avg}`)
    assert.equal(snap.day, at(year, month, day).getDay())
    assert.equal(snap.hour, hour)
  }
})

test('friday and saturday midnight bar intensity stays at the daytime floor', () => {
  // BUG?: barCurve checks `hour < 16` before `hour < 2`, so hours 0 and 1 never
  // reach the late-night branch (Fri/Sat 0.78, Thursday 0.45, other days 0.16).
  // Friday 00:30 College Ave is 0.08 and downtownNow says "Picking up" (avg 0.2725).
  // Expected once that branch can run: bar intensity 0.78 and label "Packed"
  // ((0.78 * 3 + 0.85) / 4 = 0.7975). Thursday 00:30 should be 0.45, not 0.04;
  // Wednesday 00:30 should be 0.16, not 0.04. The trailing
  // `return weekend ? 0.18 : 0.06` is also unreachable for hours 0–23.
  const friday = downtownNow(at(2026, 9, 25, 0, 30))
  assert.equal(friday.day, 5)
  assert.equal(friday.hour, 0)
  assert.equal(friday.label, 'Picking up')
  near(friday.avg, 0.2725)
  for (const id of ['college-ave-core', 'tiger-town', 'study-hall']) {
    assert.equal(byId(friday.spots, id).intensity, 0.08)
  }
  assert.equal(byId(friday.spots, 'keith-st').intensity, 0.85)

  const fridayOne = downtownNow(at(2026, 9, 25, 1, 15))
  assert.equal(byId(fridayOne.spots, 'college-ave-core').intensity, 0.08)
  assert.equal(fridayOne.label, 'Picking up')

  const saturday = downtownNow(at(2026, 9, 26, 0, 30))
  assert.equal(byId(saturday.spots, 'college-ave-core').intensity, 0.08)
  assert.equal(saturday.label, 'Picking up')

  const thursday = downtownNow(at(2026, 9, 24, 0, 30))
  assert.equal(byId(thursday.spots, 'college-ave-core').intensity, 0.04)
  assert.equal(thursday.label, 'Quiet')

  const wednesday = downtownNow(at(2026, 9, 23, 1, 30))
  assert.equal(byId(wednesday.spots, 'college-ave-core').intensity, 0.04)
  assert.equal(wednesday.label, 'Quiet')
})

test('an invalid date does not throw and uses the quiet tail of the curves', () => {
  const snap = downtownNow(new Date(NaN))
  assert.ok(Number.isNaN(snap.day))
  assert.ok(Number.isNaN(snap.hour))
  assert.equal(snap.label, 'Quiet')
  near(snap.avg, 0.054)
  assert.equal(byId(snap.spots, 'college-ave-core').intensity, 0.06)
  assert.equal(byId(snap.spots, 'keith-st').intensity, 0.036)
  assert.equal(typicalSpots(new Date(NaN)).length, DOWNTOWN_VENUES.length + CAMPUS_ANCHORS.length)
})

test('reading demand does not mutate the catalogs', () => {
  const downtown = structuredClone(DOWNTOWN_VENUES)
  const campus = structuredClone(CAMPUS_ANCHORS)
  const when = at(2026, 9, 25, 23, 45)
  downtownNow(when)
  typicalSpots(when)
  previewDate('friday_night', when)
  resolveDemandRange('friday_night', when)
  assert.deepEqual(DOWNTOWN_VENUES, downtown)
  assert.deepEqual(CAMPUS_ANCHORS, campus)
  assert.equal(when.getTime(), at(2026, 9, 25, 23, 45).getTime())
})

test('typical spots list downtown then campus, without the curve name', () => {
  const when = at(2026, 9, 25, 22, 10)
  const spots = typicalSpots(when)
  assert.equal(spots.length, 9)
  assert.deepEqual(
    spots.map((spot) => spot.id),
    [...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS].map((venue) => venue.id),
  )
  spots.forEach((spot, index) => {
    const venue = [...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS][index]
    assert.equal(spot.name, venue.name)
    assert.equal(spot.lat, venue.lat)
    assert.equal(spot.lng, venue.lng)
    assert.equal(spot.radius, venue.radius)
    assert.equal(spot.source, 'typical')
    assert.equal(spot.curve, undefined)
    assert.deepEqual(Object.keys(spot).sort(), ['id', 'intensity', 'lat', 'lng', 'name', 'radius', 'source'])
    assert.ok(spot.intensity >= 0 && spot.intensity <= 1)
  })
  const downtown = downtownNow(when)
  for (const venue of DOWNTOWN_VENUES) {
    assert.equal(byId(spots, venue.id).intensity, byId(downtown.spots, venue.id).intensity)
  }
})

test('venues that share a curve stay tied across the week', () => {
  for (let day = 20; day <= 26; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const spots = typicalSpots(at(2026, 9, day, hour, 10))
      const intensity = (id) => byId(spots, id).intensity
      assert.equal(intensity('tiger-town'), intensity('college-ave-core'))
      assert.equal(intensity('study-hall'), intensity('college-ave-core'))
      assert.equal(intensity('fraternity-row'), intensity('keith-st'))
      assert.equal(intensity('shoeboxes'), intensity('holmes-hall'))
    }
  }
})

test('only the clock hour changes intensity', () => {
  const onTheHour = typicalSpots(at(2026, 9, 23, 8, 0, 0, 0)).map((spot) => spot.intensity)
  const endOfHour = typicalSpots(at(2026, 9, 23, 8, 59, 59, 999)).map((spot) => spot.intensity)
  assert.deepEqual(endOfHour, onTheHour)
  const previousHour = typicalSpots(at(2026, 9, 23, 7, 59)).map((spot) => spot.intensity)
  assert.notDeepEqual(previousHour, onTheHour)
})

test('each curve hits its hour and weekday boundaries', () => {
  // [year, month, day, hour, id, expected]. 2026-09-20 is Sunday through 2026-09-26 Saturday.
  // Hours 0 and 1 on the bar curve are the shadowed late-night branch; see the midnight test.
  const rows = [
    [2026, 9, 23, 15, 'college-ave-core', 0.04],
    [2026, 9, 25, 15, 'college-ave-core', 0.08],
    [2026, 9, 26, 15, 'college-ave-core', 0.08],
    [2026, 9, 20, 12, 'college-ave-core', 0.04],
    [2026, 9, 23, 16, 'college-ave-core', 0.1],
    [2026, 9, 23, 18, 'college-ave-core', 0.1],
    [2026, 9, 24, 16, 'college-ave-core', 0.18],
    [2026, 9, 25, 16, 'college-ave-core', 0.28],
    [2026, 9, 23, 19, 'college-ave-core', 0.18],
    [2026, 9, 23, 20, 'college-ave-core', 0.18],
    [2026, 9, 24, 19, 'college-ave-core', 0.35],
    [2026, 9, 25, 19, 'college-ave-core', 0.55],
    [2026, 9, 23, 21, 'college-ave-core', 0.28],
    [2026, 9, 23, 22, 'college-ave-core', 0.28],
    [2026, 9, 24, 21, 'college-ave-core', 0.58],
    [2026, 9, 25, 21, 'college-ave-core', 0.92],
    [2026, 9, 25, 22, 'college-ave-core', 0.92],
    [2026, 9, 23, 23, 'college-ave-core', 0.32],
    [2026, 9, 24, 23, 'college-ave-core', 0.7],
    [2026, 9, 25, 23, 'college-ave-core', 1],
    [2026, 9, 26, 23, 'college-ave-core', 1],
    [2026, 9, 25, 0, 'college-ave-core', 0.08],
    [2026, 9, 25, 1, 'college-ave-core', 0.08],
    [2026, 9, 25, 2, 'college-ave-core', 0.08],
    [2026, 9, 24, 0, 'college-ave-core', 0.04],
    [2026, 9, 23, 0, 'college-ave-core', 0.04],

    [2026, 9, 25, 21, 'keith-st', 0.85],
    [2026, 9, 25, 23, 'keith-st', 0.85],
    [2026, 9, 25, 0, 'keith-st', 0.85],
    [2026, 9, 25, 2, 'keith-st', 0.85],
    [2026, 9, 25, 3, 'keith-st', 0.048],
    [2026, 9, 26, 2, 'keith-st', 0.85],
    [2026, 9, 23, 22, 'keith-st', 0.35],
    [2026, 9, 24, 22, 'keith-st', 0.35],
    [2026, 9, 20, 1, 'keith-st', 0.35],
    [2026, 9, 20, 3, 'keith-st', 0.024],
    [2026, 9, 23, 8, 'keith-st', 0.024],
    [2026, 9, 23, 16, 'keith-st', 0.06],
    [2026, 9, 24, 16, 'keith-st', 0.108],
    [2026, 9, 25, 16, 'keith-st', 0.168],
    [2026, 9, 23, 19, 'keith-st', 0.108],
    [2026, 9, 24, 19, 'keith-st', 0.21],
    [2026, 9, 25, 20, 'keith-st', 0.33],
    [2026, 9, 23, 21, 'keith-st', 0.35],

    [2026, 9, 23, 6, 'holmes-hall', 0.15],
    [2026, 9, 23, 7, 'holmes-hall', 0.55],
    [2026, 9, 23, 9, 'holmes-hall', 0.55],
    [2026, 9, 23, 10, 'holmes-hall', 0.15],
    [2026, 9, 23, 11, 'holmes-hall', 0.35],
    [2026, 9, 23, 13, 'holmes-hall', 0.35],
    [2026, 9, 23, 14, 'holmes-hall', 0.15],
    [2026, 9, 23, 16, 'holmes-hall', 0.45],
    [2026, 9, 23, 18, 'holmes-hall', 0.45],
    [2026, 9, 23, 19, 'holmes-hall', 0.15],
    [2026, 9, 23, 21, 'holmes-hall', 0.4],
    [2026, 9, 23, 0, 'holmes-hall', 0.4],
    [2026, 9, 23, 1, 'holmes-hall', 0.4],
    [2026, 9, 23, 2, 'holmes-hall', 0.15],
    [2026, 9, 25, 7, 'holmes-hall', 0.25],
    [2026, 9, 26, 7, 'holmes-hall', 0.25],
    [2026, 9, 20, 7, 'holmes-hall', 0.55],
    [2026, 9, 25, 16, 'holmes-hall', 0.4],
    [2026, 9, 25, 21, 'holmes-hall', 0.7],
    [2026, 9, 25, 1, 'holmes-hall', 0.7],
    [2026, 9, 20, 21, 'holmes-hall', 0.4],
    [2026, 9, 26, 12, 'holmes-hall', 0.35],

    [2026, 9, 23, 7, 'core-campus', 0.12],
    [2026, 9, 23, 8, 'core-campus', 0.55],
    [2026, 9, 23, 16, 'core-campus', 0.55],
    [2026, 9, 23, 17, 'core-campus', 0.35],
    [2026, 9, 23, 20, 'core-campus', 0.35],
    [2026, 9, 23, 21, 'core-campus', 0.12],
    [2026, 9, 23, 0, 'core-campus', 0.12],
    [2026, 9, 20, 8, 'core-campus', 0.25],
    [2026, 9, 26, 12, 'core-campus', 0.25],
    [2026, 9, 25, 12, 'core-campus', 0.55],
    [2026, 9, 20, 17, 'core-campus', 0.35],
    [2026, 9, 26, 20, 'core-campus', 0.35],

    [2026, 9, 26, 9, 'memorial-stadium', 0.125],
    [2026, 9, 26, 10, 'memorial-stadium', 0.95],
    [2026, 9, 26, 15, 'memorial-stadium', 0.95],
    [2026, 9, 26, 19, 'memorial-stadium', 0.95],
    [2026, 9, 26, 20, 'memorial-stadium', 0.175],
    [2026, 9, 26, 21, 'memorial-stadium', 0.06],
    [2026, 9, 25, 15, 'memorial-stadium', 0.275],
    [2026, 9, 25, 16, 'memorial-stadium', 0.55],
    [2026, 9, 25, 23, 'memorial-stadium', 0.55],
    [2026, 9, 25, 0, 'memorial-stadium', 0.06],
    [2026, 9, 23, 12, 'memorial-stadium', 0.275],
    [2026, 9, 20, 12, 'memorial-stadium', 0.125],
    [2026, 9, 24, 18, 'memorial-stadium', 0.175],
    [2026, 9, 23, 7, 'memorial-stadium', 0.06],
  ]
  for (const [year, month, day, hour, id, expected] of rows) {
    const spot = byId(typicalSpots(at(year, month, day, hour, 30)), id)
    near(spot.intensity, expected, `${id} ${year}-${month}-${day} ${hour}:00 expected ${expected}, got ${spot.intensity}`)
  }
})

test('every hour of a fixed week stays in range and uses a known label', () => {
  const seen = new Set()
  for (let day = 20; day <= 26; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const date = at(2026, 9, day, hour, 15)
      const snap = downtownNow(date)
      assert.equal(snap.day, date.getDay())
      assert.equal(snap.hour, hour)
      assert.ok(LABELS.includes(snap.label))
      seen.add(snap.label)
      assert.equal(snap.spots.length, 4)
      near(snap.avg, snap.spots.reduce((sum, spot) => sum + spot.intensity, 0) / 4)
      for (const spot of typicalSpots(date)) {
        assert.equal(spot.source, 'typical')
        assert.ok(spot.intensity >= 0 && spot.intensity <= 1)
      }
    }
  }
  assert.deepEqual([...seen].sort(), [...LABELS].sort())
})

test('weekday morning preview anchors on Wednesday at 08:30', () => {
  const cases = [
    [9, 20, 9, 16],
    [9, 21, 9, 23],
    [9, 22, 9, 23],
    [9, 23, 9, 23],
    [9, 24, 9, 23],
    [9, 25, 9, 23],
    [3, 1, 2, 25],
  ]
  for (const [month, day, expectMonth, expectDay] of cases) {
    const now = at(2026, month, day, 19, 4, 5, 6)
    const stamp = now.getTime()
    const preview = previewDate('weekday_am', now)
    assert.notEqual(preview, now)
    assert.equal(now.getTime(), stamp)
    assert.equal(preview.getFullYear(), 2026)
    assert.equal(preview.getMonth() + 1, expectMonth)
    assert.equal(preview.getDate(), expectDay)
    assert.equal(preview.getDay(), 3)
    assert.equal(preview.getHours(), 8)
    assert.equal(preview.getMinutes(), 30)
    assert.equal(preview.getSeconds(), 0)
    assert.equal(preview.getMilliseconds(), 0)
  }

  const already = at(2026, 9, 23, 8, 30, 0, 0)
  const sameMorning = previewDate('weekday_am', already)
  assert.equal(sameMorning.getTime(), already.getTime())
  assert.notEqual(sameMorning, already)
})

test('saturday weekday morning preview lands on Wednesday', () => {
  // Saturday uses the same Wednesday 08:30 anchor as the other non-Sunday days
  // (delta 3 - 6 = -3). 2026-09-26 previews Wednesday 2026-09-23 08:30.
  const now = at(2026, 9, 26, 19, 40, 1, 2)
  const stamp = now.getTime()
  const preview = previewDate('weekday_am', now)
  assert.notEqual(preview, now)
  assert.equal(now.getTime(), stamp)
  assert.equal(preview.getFullYear(), 2026)
  assert.equal(preview.getMonth() + 1, 9)
  assert.equal(preview.getDate(), 23)
  assert.equal(preview.getDay(), 3)
  assert.equal(preview.getHours(), 8)
  assert.equal(preview.getMinutes(), 30)
  assert.equal(preview.getSeconds(), 0)
  assert.equal(preview.getMilliseconds(), 0)

  const snap = downtownNow(preview)
  assert.equal(snap.day, 3)
  assert.equal(snap.hour, 8)
  assert.equal(snap.label, 'Quiet')
  const wednesdayMorning = typicalSpots(at(2026, 9, 23, 8, 30))
  assert.deepEqual(
    typicalSpots(preview).map((spot) => spot.intensity),
    wednesdayMorning.map((spot) => spot.intensity),
  )
})

test('friday night preview is Friday at 22:00, including across the new year', () => {
  const cases = [
    [2026, 9, 20, 2026, 9, 25],
    [2026, 9, 21, 2026, 9, 25],
    [2026, 9, 22, 2026, 9, 25],
    [2026, 9, 23, 2026, 9, 25],
    [2026, 9, 24, 2026, 9, 25],
    [2026, 9, 25, 2026, 9, 25],
    [2026, 9, 26, 2026, 10, 2],
    [2026, 12, 31, 2027, 1, 1],
    [2026, 9, 25, 2026, 9, 25],
  ]
  for (const [year, month, day, expectYear, expectMonth, expectDay] of cases) {
    const now = at(year, month, day, 0, 30, 12, 7)
    const stamp = now.getTime()
    const preview = previewDate('friday_night', now)
    assert.notEqual(preview, now)
    assert.equal(now.getTime(), stamp)
    assert.equal(preview.getFullYear(), expectYear)
    assert.equal(preview.getMonth() + 1, expectMonth)
    assert.equal(preview.getDate(), expectDay)
    assert.equal(preview.getDay(), 5)
    assert.equal(preview.getHours(), 22)
    assert.equal(preview.getMinutes(), 0)
    assert.equal(preview.getSeconds(), 0)
    assert.equal(preview.getMilliseconds(), 0)
  }

  const during = at(2026, 9, 25, 23, 15)
  const tonight = previewDate('friday_night', during)
  assert.equal(tonight.getDate(), 25)
  assert.equal(tonight.getHours(), 22)

  const packed = downtownNow(previewDate('friday_night', at(2026, 9, 24, 8)))
  assert.equal(packed.day, 5)
  assert.equal(packed.hour, 22)
  assert.equal(packed.label, 'Packed')
})

test('unknown preview windows return the same date instance', () => {
  for (const windowId of ['now', 'last_7d', 'mystery', '', 'WEEKDAY_AM', 'friday-night', null, undefined]) {
    const now = at(2026, 9, 24, 15, 45, 30, 123)
    const preview = previewDate(windowId, now)
    assert.equal(preview, now, String(windowId))
    assert.equal(preview.getTime(), at(2026, 9, 24, 15, 45, 30, 123).getTime())
  }
})

test('demand ranges match the busy-mode windows', () => {
  const now = at(2026, 9, 24, 15, 45, 30, 123)
  const cases = [
    ['weekday_am', 30, 7, 10],
    ['friday_night', 30, 21, 23],
    ['last_7d', 7, null, null],
    ['now', 14, null, null],
    ['mystery', 14, null, null],
    ['', 14, null, null],
    [null, 14, null, null],
    [undefined, 14, null, null],
  ]
  for (const [windowId, daysBack, hourStart, hourEnd] of cases) {
    const range = resolveDemandRange(windowId, now)
    assert.deepEqual(Object.keys(range).sort(), ['from', 'hourEnd', 'hourStart', 'to'], String(windowId))
    assert.ok(range.from instanceof Date)
    assert.ok(range.to instanceof Date)
    assert.notEqual(range.from, now)
    assert.notEqual(range.to, now)
    assert.notEqual(range.from, range.to)
    assert.equal(range.to.getTime(), now.getTime(), String(windowId))
    assert.equal(range.from.getTime(), now.getTime() - daysBack * DAY_MS, String(windowId))
    assert.equal(range.hourStart, hourStart, String(windowId))
    assert.equal(range.hourEnd, hourEnd, String(windowId))
    assert.equal(now.getTime(), at(2026, 9, 24, 15, 45, 30, 123).getTime())
  }
})

test('a demand range is a copy the caller can mutate', () => {
  const now = at(2026, 8, 2, 9, 0, 0, 0)
  const range = resolveDemandRange('last_7d', now)
  range.from.setFullYear(1999)
  range.to.setHours(1)
  assert.equal(now.getTime(), at(2026, 8, 2, 9, 0, 0, 0).getTime())
  const again = resolveDemandRange('weekday_am', now)
  assert.equal(again.from.getTime(), now.getTime() - 30 * DAY_MS)
  assert.equal(again.to.getTime(), now.getTime())
  assert.equal(again.hourStart, 7)
  assert.equal(again.hourEnd, 10)
})
