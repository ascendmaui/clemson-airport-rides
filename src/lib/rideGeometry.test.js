import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CITY_MPS,
  clockTime,
  estimateLeg,
  fetchDrivingLeg,
  formatMiles,
  formatMinutes,
  haversineMeters,
  hourlyRateCents,
  minutesUntilDropoff,
} from './rideGeometry.js'

test('CITY_MPS defines default city speed of 11.5 m/s (~25.7 mph)', () => {
  assert.equal(CITY_MPS, 11.5)
  const mph = (CITY_MPS * 3600) / 1609.344
  assert.ok(mph > 25.7 && mph < 25.8)
})

test('haversineMeters: same point returns 0 meters', () => {
  assert.equal(haversineMeters(34.6836, -82.8364, 34.6836, -82.8364), 0)
  assert.equal(haversineMeters(0, 0, 0, 0), 0)
  assert.equal(haversineMeters(90, 0, 90, 0), 0)
  assert.equal(haversineMeters(-45.5, 120.25, -45.5, 120.25), 0)
})

test('haversineMeters: antipodes return half-circumference (~20,015 km) without NaN', () => {
  const halfCircumference = Math.PI * 6371000 // ~20,015,087 m

  // Equator antipodes (0, 0) and (0, 180)
  const eqDist = haversineMeters(0, 0, 0, 180)
  assert.ok(Number.isFinite(eqDist))
  assert.ok(Math.abs(eqDist - halfCircumference) < 0.1)

  // North Pole to South Pole (90, 0) and (-90, 0)
  const poleDist = haversineMeters(90, 0, -90, 0)
  assert.ok(Number.isFinite(poleDist))
  assert.ok(Math.abs(poleDist - halfCircumference) < 0.1)

  // Clemson area antipode (34.6836, -82.8364) and (-34.6836, 97.1636)
  const clemsonAntipode = haversineMeters(34.6836, -82.8364, -34.6836, 97.1636)
  assert.ok(Number.isFinite(clemsonAntipode))
  assert.ok(Math.abs(clemsonAntipode - halfCircumference) < 0.1)
})

test('haversineMeters: accurate distance for known real-world coordinates and numeric strings', () => {
  // Clemson Memorial Stadium (34.6788, -82.8432) to GSP Airport (34.8957, -82.2189)
  const dMeters = haversineMeters(34.6788, -82.8432, 34.8957, -82.2189)
  assert.ok(dMeters > 61500 && dMeters < 62500, `Expected ~61.9 km, got ${dMeters}`)

  // Supports numeric strings
  const dString = haversineMeters('34.6788', '-82.8432', '34.8957', '-82.2189')
  assert.equal(dString, dMeters)

  // 1 degree latitude along prime meridian (~111.195 km)
  const oneDegLat = haversineMeters(0, 0, 1, 0)
  assert.ok(Math.abs(oneDegLat - (2 * Math.PI * 6371000) / 360) < 0.1)
})

test('haversineMeters: null/NaN and non-finite coords return null', () => {
  assert.equal(haversineMeters(NaN, -82.84, 34.68, -82.84), null)
  assert.equal(haversineMeters(34.68, NaN, 34.68, -82.84), null)
  assert.equal(haversineMeters(34.68, -82.84, NaN, -82.84), null)
  assert.equal(haversineMeters(34.68, -82.84, 34.68, NaN), null)
  assert.equal(haversineMeters(undefined, -82.84, 34.68, -82.84), null)
  assert.equal(haversineMeters(Infinity, -82.84, 34.68, -82.84), null)
  assert.equal(haversineMeters(-Infinity, -82.84, 34.68, -82.84), null)
  assert.equal(haversineMeters('not-a-number', -82.84, 34.68, -82.84), null)

  // BUG?: Number(null), Number(''), and Number(false) coerce to 0, calculating distance from 0 rather than returning null.
  assert.equal(typeof haversineMeters(null, -82.84, 34.68, -82.84), 'number')
  assert.equal(typeof haversineMeters('', -82.84, 34.68, -82.84), 'number')
  assert.equal(typeof haversineMeters(false, -82.84, 34.68, -82.84), 'number')
})

test('estimateLeg: calculates meters, seconds, and path with default and custom speed', () => {
  const from = [34.6788, -82.8432]
  const to = [34.8957, -82.2189]
  const leg = estimateLeg(from, to)

  assert.ok(leg.meters > 61500 && leg.meters < 62500)
  assert.equal(leg.seconds, leg.meters / CITY_MPS)
  assert.deepEqual(leg.path, [from, to])

  // Custom speed in m/s
  const fastLeg = estimateLeg(from, to, 23.0)
  assert.equal(fastLeg.meters, leg.meters)
  assert.equal(fastLeg.seconds, leg.meters / 23.0)

  // String mps converts
  const strSpeedLeg = estimateLeg(from, to, '20')
  assert.equal(strSpeedLeg.seconds, leg.meters / 20)
})

test('estimateLeg: edge cases for same point, missing coords, and zero/negative mps', () => {
  const pt = [34.68, -82.84]

  // Same point
  const zeroLeg = estimateLeg(pt, pt)
  assert.deepEqual(zeroLeg, { meters: 0, seconds: 0, path: [pt, pt] })

  // Missing coords return null
  assert.equal(estimateLeg(null, pt), null)
  assert.equal(estimateLeg(pt, null), null)
  assert.equal(estimateLeg(null, null), null)
  assert.equal(estimateLeg(undefined, undefined), null)
  assert.equal(estimateLeg([], pt), null)
  assert.equal(estimateLeg(pt, []), null)
  assert.equal(estimateLeg([NaN, -82.84], pt), null)

  // BUG?: estimateLeg expects coordinate tuples [lat, lng] and returns null for { lat, lng } objects.
  assert.equal(estimateLeg({ lat: 34.68, lng: -82.84 }, { lat: 34.69, lng: -82.85 }), null)

  // BUG?: Non-positive or invalid mps silently falls back to CITY_MPS instead of throwing or reporting invalid speed.
  const to = [34.89, -82.22]
  const baseLeg = estimateLeg(pt, to)
  assert.equal(estimateLeg(pt, to, 0).seconds, baseLeg.seconds)
  assert.equal(estimateLeg(pt, to, -10).seconds, baseLeg.seconds)
  assert.equal(estimateLeg(pt, to, null).seconds, baseLeg.seconds)
  assert.equal(estimateLeg(pt, to, undefined).seconds, baseLeg.seconds)
  assert.equal(estimateLeg(pt, to, NaN).seconds, baseLeg.seconds)
  assert.equal(estimateLeg(pt, to, 'fast').seconds, baseLeg.seconds)
})

test('hourlyRateCents: driver hourly rate calculation and rounding', () => {
  // $30 fare with 600s pickup + 3000s trip = 3600s occupied (1 hr) -> 3000 cents/hr
  assert.deepEqual(hourlyRateCents(3000, 600, 3000), {
    occupiedSec: 3600,
    hourlyCents: 3000,
  })

  // $25 fare with 300s pickup + 1500s trip = 1800s occupied (0.5 hr) -> 5000 cents/hr
  assert.deepEqual(hourlyRateCents(2500, 300, 1500), {
    occupiedSec: 1800,
    hourlyCents: 5000,
  })

  // Rounding: 3500 cents over 2700s (0.75h) -> 4666.67 -> 4667 cents/hr
  assert.deepEqual(hourlyRateCents(3500, 900, 1800), {
    occupiedSec: 2700,
    hourlyCents: 4667,
  })

  // String coercion
  assert.deepEqual(hourlyRateCents('3000', '600', '3000'), {
    occupiedSec: 3600,
    hourlyCents: 3000,
  })
})

test('hourlyRateCents: handles zero/negative fare and zero/negative seconds floor', () => {
  // Zero or negative fare returns 0 hourlyCents
  assert.deepEqual(hourlyRateCents(0, 600, 1200), { occupiedSec: 1800, hourlyCents: 0 })
  assert.deepEqual(hourlyRateCents(-1000, 600, 1200), { occupiedSec: 1800, hourlyCents: 0 })
  assert.deepEqual(hourlyRateCents(null, 600, 1200), { occupiedSec: 1800, hourlyCents: 0 })
  assert.deepEqual(hourlyRateCents(undefined, 600, 1200), { occupiedSec: 1800, hourlyCents: 0 })
  assert.deepEqual(hourlyRateCents('free', 600, 1200), { occupiedSec: 1800, hourlyCents: 0 })

  // Occupied seconds is floored at 60 seconds minimum
  assert.deepEqual(hourlyRateCents(0, 0, 0), { occupiedSec: 60, hourlyCents: 0 })
  assert.deepEqual(hourlyRateCents(0, -100, -200), { occupiedSec: 60, hourlyCents: 0 })

  const minOccupied = hourlyRateCents(100, 0, 0)
  assert.equal(minOccupied.occupiedSec, 60)
  // 100 / (60 / 3600) = 6000 cents/hr
  assert.equal(minOccupied.hourlyCents, 6000)

  // BUG?: Negative seconds in toPickupSec or tripSec are summed directly before Math.max(60, sum),
  // allowing negative pickup time to offset positive trip time.
  const offsetRate = hourlyRateCents(3000, -600, 4200)
  assert.equal(offsetRate.occupiedSec, 3600)
  assert.equal(offsetRate.hourlyCents, 3000)

  // Null/undefined seconds default to 0
  assert.deepEqual(hourlyRateCents(3000, null, undefined), {
    occupiedSec: 60,
    hourlyCents: 180000,
  })
})

test('minutesUntilDropoff: with selfPos measures straight-line from driver to dropoff', () => {
  const selfPos = [34.68, -82.84]
  const dropoff = [34.89, -82.22]
  const pickup = [34.69, -82.83]
  const expectedMin = estimateLeg(selfPos, dropoff).seconds / 60

  // Whenever selfPos and dropoff exist, estimateLeg(selfPos, dropoff) is returned
  assert.equal(minutesUntilDropoff({ selfPos, dropoff, pickup, status: 'in_progress' }), expectedMin)

  // BUG?: With selfPos provided during 'accepted' or 'arriving', minutesUntilDropoff measures direct straight-line
  // driver -> dropoff, skipping the pickup stop entirely.
  assert.equal(minutesUntilDropoff({ selfPos, dropoff, pickup, status: 'accepted' }), expectedMin)
  assert.equal(minutesUntilDropoff({ selfPos, dropoff, pickup, status: 'arriving' }), expectedMin)
  assert.equal(minutesUntilDropoff({ selfPos, dropoff, pickup, status: 'searching' }), expectedMin)
})

test('minutesUntilDropoff: without selfPos for statuses accepted, arriving, and searching returns Infinity', () => {
  const pickup = [34.69, -82.83]
  const dropoff = [34.89, -82.22]

  // BUG?: Without selfPos, 'accepted' and 'arriving' return Infinity rather than estimating from pickup to dropoff.
  assert.equal(minutesUntilDropoff({ dropoff, pickup, status: 'accepted' }), Infinity)
  assert.equal(minutesUntilDropoff({ dropoff, pickup, status: 'arriving' }), Infinity)
  assert.equal(minutesUntilDropoff({ dropoff, pickup, status: 'searching' }), Infinity)
  assert.equal(minutesUntilDropoff({ dropoff, pickup, status: 'scheduled' }), Infinity)
  assert.equal(minutesUntilDropoff({ dropoff, pickup, status: 'completed' }), Infinity)
  assert.equal(minutesUntilDropoff({ dropoff, pickup, status: null }), Infinity)
  assert.equal(minutesUntilDropoff({}), Infinity)
})

test('minutesUntilDropoff: without selfPos for in_progress models progress from acceptedAt', () => {
  const pickup = [34.69, -82.83]
  const dropoff = [34.89, -82.22]
  const totalTripMin = estimateLeg(pickup, dropoff).seconds / 60

  // Just accepted (elapsed = 0): returns full trip duration
  const justAccepted = new Date().toISOString()
  const etaNow = minutesUntilDropoff({ status: 'in_progress', pickup, dropoff, acceptedAt: justAccepted })
  assert.ok(Math.abs(etaNow - totalTripMin) < 0.05)

  // 10 minutes elapsed: progress onTrip is elapsed * 0.6 = 6 minutes deducted
  // BUG?: Elapsed time is measured from acceptedAt (including driver travel to pickup) rather than when trip actually started in_progress.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const eta10 = minutesUntilDropoff({ status: 'in_progress', pickup, dropoff, acceptedAt: tenMinAgo })
  assert.ok(Math.abs(eta10 - Math.max(0, totalTripMin - 6)) < 0.1)

  // 5 hours elapsed: onTrip (300 min * 0.6 = 180 min) exceeds total trip time (~90 min) -> clamped to 0 minutes remaining
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString()
  const etaClamped = minutesUntilDropoff({ status: 'in_progress', pickup, dropoff, acceptedAt: fiveHoursAgo })
  assert.equal(etaClamped, 0)

  // Future acceptedAt (elapsed < 0) returns full trip duration
  const future = new Date(Date.now() + 60 * 1000).toISOString()
  assert.equal(minutesUntilDropoff({ status: 'in_progress', pickup, dropoff, acceptedAt: future }), totalTripMin)

  // Invalid acceptedAt date returns full trip duration
  assert.equal(minutesUntilDropoff({ status: 'in_progress', pickup, dropoff, acceptedAt: 'invalid' }), totalTripMin)

  // Missing pickup or dropoff returns Infinity
  assert.equal(minutesUntilDropoff({ status: 'in_progress', dropoff, acceptedAt: justAccepted }), Infinity)
  assert.equal(minutesUntilDropoff({ status: 'in_progress', pickup, acceptedAt: justAccepted }), Infinity)
  assert.equal(minutesUntilDropoff({ status: 'in_progress', pickup, dropoff }), Infinity)
  assert.equal(minutesUntilDropoff({ status: 'in_progress', pickup: [NaN, 0], dropoff, acceptedAt: justAccepted }), Infinity)
})

test('formatMinutes: formats minutes and hours, handling zero/negative seconds floor', () => {
  // BUG?: formatMinutes(0) and negative seconds return "1 min" due to Math.max(1, ...), never returning "0 min".
  assert.equal(formatMinutes(0), '1 min')
  assert.equal(formatMinutes(-15), '1 min')
  assert.equal(formatMinutes(-3600), '1 min')

  // Under a minute
  assert.equal(formatMinutes(20), '1 min')
  assert.equal(formatMinutes(30), '1 min')
  assert.equal(formatMinutes(59), '1 min')

  // Multiple minutes under an hour
  assert.equal(formatMinutes(60), '1 min')
  assert.equal(formatMinutes(90), '2 min')
  assert.equal(formatMinutes(300), '5 min')
  assert.equal(formatMinutes(3540), '59 min')
  assert.equal(formatMinutes(3569), '59 min')

  // Hours: exact hour has "0m"
  // BUG?: Exact hour values format as "1h 0m" rather than "1h".
  assert.equal(formatMinutes(3570), '1h 0m')
  assert.equal(formatMinutes(3600), '1h 0m')
  assert.equal(formatMinutes(7200), '2h 0m')

  // Hours and minutes
  assert.equal(formatMinutes(3660), '1h 1m')
  assert.equal(formatMinutes(5400), '1h 30m')
  assert.equal(formatMinutes(7500), '2h 5m')

  // Non-numeric / falsy fallbacks
  assert.equal(formatMinutes(null), '1 min')
  assert.equal(formatMinutes(undefined), '1 min')
  assert.equal(formatMinutes(NaN), '1 min')
  assert.equal(formatMinutes('180'), '3 min')
})

test('formatMiles: formats miles with < 0.1 mi threshold, handling zero and negative values', () => {
  // BUG?: Negative meters format as "< 0.1 mi" instead of throwing or returning negative/zero.
  assert.equal(formatMiles(0), '< 0.1 mi')
  assert.equal(formatMiles(-50), '< 0.1 mi')
  assert.equal(formatMiles(-1609), '< 0.1 mi')

  // Less than 0.1 mile
  assert.equal(formatMiles(50), '< 0.1 mi')
  assert.equal(formatMiles(100), '< 0.1 mi')
  assert.equal(formatMiles(160), '< 0.1 mi') // ~0.0994 mi

  // 0.1 mi threshold and standard distances
  assert.equal(formatMiles(161), '0.1 mi') // ~0.10004 mi
  assert.equal(formatMiles(1609.344), '1.0 mi')
  assert.equal(formatMiles(2414.016), '1.5 mi')
  assert.equal(formatMiles(8046.72), '5.0 mi')
  assert.equal(formatMiles(16093.44), '10.0 mi')

  // Non-numeric / falsy fallbacks
  assert.equal(formatMiles(null), '< 0.1 mi')
  assert.equal(formatMiles(undefined), '< 0.1 mi')
  assert.equal(formatMiles(NaN), '< 0.1 mi')
  assert.equal(formatMiles('1609.344'), '1.0 mi')
})

test('clockTime: formats time, handling clock rollover past midnight and zero/negative offsets', () => {
  // Midnight rollover: 11:55 PM (23:55:00) + 10 min (600s) -> 12:05 AM next day
  const lateNight = new Date(2026, 8, 25, 23, 55, 0).getTime()
  const rolledMidnight = clockTime(lateNight, 600)
  const expectedMidnight = new Date(lateNight + 600 * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
  assert.equal(rolledMidnight, expectedMidnight)
  assert.match(rolledMidnight, /12:05|00:05/)

  // 11:59:45 PM + 20s -> 12:00 AM
  const justBeforeMidnight = new Date(2026, 8, 25, 23, 59, 45).getTime()
  const rolledExactMidnight = clockTime(justBeforeMidnight, 20)
  assert.match(rolledExactMidnight, /12:00|00:00/)

  // 11:00 PM + 2 hours (7200s) -> 1:00 AM next day
  const twoHoursPast = clockTime(new Date(2026, 8, 25, 23, 0, 0).getTime(), 7200)
  assert.match(twoHoursPast, /1:00|01:00/)

  // Noon rollover: 11:55 AM + 10 min -> 12:05 PM
  const morningTime = new Date(2026, 8, 25, 11, 55, 0).getTime()
  const noonRolled = clockTime(morningTime, 600)
  assert.match(noonRolled, /12:05/)

  // Zero or negative plusSec clamped to 0 added seconds
  const baseFormatted = new Date(lateNight).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  assert.equal(clockTime(lateNight, 0), baseFormatted)
  assert.equal(clockTime(lateNight, -600), baseFormatted)
  assert.equal(clockTime(lateNight, null), baseFormatted)
  assert.equal(clockTime(lateNight, undefined), baseFormatted)
  assert.equal(clockTime(lateNight, NaN), baseFormatted)

  // BUG?: clockTime uses system default locale [], meaning formatting depends on machine locale.
  // BUG?: Passing an invalid fromMs (NaN) returns "Invalid Date" string rather than null or throwing.
  assert.equal(clockTime(NaN, 60), 'Invalid Date')
})

test('fetchDrivingLeg: safely returns null when window/Google Maps is not present', async () => {
  // In Node environment, window is undefined; verify fetchDrivingLeg returns null without throwing
  const result = await fetchDrivingLeg([34.6788, -82.8432], [34.8957, -82.2189])
  assert.equal(result, null)
  assert.equal(await fetchDrivingLeg(null, null), null)
})
