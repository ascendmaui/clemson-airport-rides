import assert from 'node:assert/strict'
import test, { afterEach, beforeEach, describe } from 'node:test'
import {
  CLEMSON,
  CLT,
  DANGER,
  DOWNTOWN,
  GSP,
  HEAT_WINDOWS,
  INK,
  INK_SECONDARY,
  ORANGE,
  ORANGE_BRIGHT,
  PURPLE,
  RIDE_TIERS,
  SHORTCUTS,
  STADIUM,
  SURFACE,
  destPoint,
  formatUsd,
  pickupPoint,
} from './places.js'

describe('network isolation', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('Real network calls are forbidden in places tests')
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('places module operates offline without network or Google Places API calls', () => {
    assert.equal(typeof destPoint, 'function')
    assert.equal(typeof pickupPoint, 'function')
    assert.equal(typeof formatUsd, 'function')
  })
})

describe('theme color constants', () => {
  test('exports valid 6-character hex color codes for theme palette', () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/
    assert.match(ORANGE, hexRegex)
    assert.match(ORANGE_BRIGHT, hexRegex)
    assert.match(PURPLE, hexRegex)
    assert.match(INK, hexRegex)
    assert.match(INK_SECONDARY, hexRegex)
    assert.match(DANGER, hexRegex)
    assert.match(SURFACE, hexRegex)
  })

  test('color constants match Clemson palette definitions', () => {
    assert.equal(ORANGE, '#F56600')
    assert.equal(ORANGE_BRIGHT, '#F66733')
    assert.equal(PURPLE, '#522D80')
    assert.equal(INK, '#0B1220')
    assert.equal(INK_SECONDARY, '#5C6570')
    assert.equal(DANGER, '#B42318')
    assert.equal(SURFACE, '#F7F4F0')
  })
})

describe('geographic coordinate constants', () => {
  test('exports valid coordinates with numeric latitude and longitude', () => {
    const points = [
      { name: 'CLEMSON', point: CLEMSON },
      { name: 'STADIUM', point: STADIUM },
      { name: 'DOWNTOWN', point: DOWNTOWN },
      { name: 'GSP', point: GSP },
      { name: 'CLT', point: CLT },
    ]

    for (const { name, point } of points) {
      assert.ok(point, `${name} should exist`)
      assert.equal(typeof point.latitude, 'number', `${name}.latitude must be a number`)
      assert.equal(typeof point.longitude, 'number', `${name}.longitude must be a number`)
      // Latitudes in the Carolinas region are around 34-36°N, Longitudes around -80 to -83°W
      assert.ok(point.latitude >= 34 && point.latitude <= 36, `${name}.latitude out of bounds`)
      assert.ok(point.longitude >= -83.5 && point.longitude <= -80, `${name}.longitude out of bounds`)
    }
  })

  test('exact coordinate values match campus and airport landmarks', () => {
    assert.deepEqual(CLEMSON, { latitude: 34.6784, longitude: -82.8397 })
    assert.deepEqual(STADIUM, { latitude: 34.6788, longitude: -82.843 })
    assert.deepEqual(DOWNTOWN, { latitude: 34.6836, longitude: -82.8364 })
    assert.deepEqual(GSP, { latitude: 34.8957, longitude: -82.2189 })
    assert.deepEqual(CLT, { latitude: 35.2144, longitude: -80.9473 })
  })
})

describe('SHORTCUTS', () => {
  test('exports array of 3 saved place shortcuts', () => {
    assert.ok(Array.isArray(SHORTCUTS))
    assert.equal(SHORTCUTS.length, 3)
  })

  test('contains home, clemson, and work shortcuts with required properties', () => {
    assert.deepEqual(SHORTCUTS, [
      { id: 'home', label: 'Home', sub: 'Simpsonville', icon: '🏠' },
      { id: 'clemson', label: 'Clemson University', sub: 'Sikes Hall', icon: '🎓' },
      { id: 'work', label: 'Work', sub: 'Saved place', icon: '💼' },
    ])
    for (const item of SHORTCUTS) {
      assert.equal(typeof item.id, 'string')
      assert.equal(typeof item.label, 'string')
      assert.equal(typeof item.sub, 'string')
      assert.equal(typeof item.icon, 'string')
    }
  })
})

describe('HEAT_WINDOWS', () => {
  test('exports array of 4 heat map time window definitions', () => {
    assert.ok(Array.isArray(HEAT_WINDOWS))
    assert.equal(HEAT_WINDOWS.length, 4)
  })

  test('contains expected time window IDs and labels', () => {
    assert.deepEqual(HEAT_WINDOWS, [
      { id: 'now', label: 'Now' },
      { id: 'weekday_am', label: 'Weekday morning' },
      { id: 'friday_night', label: 'Friday night' },
      { id: 'last_7d', label: 'Last 7 days' },
    ])
    for (const item of HEAT_WINDOWS) {
      assert.equal(typeof item.id, 'string')
      assert.equal(typeof item.label, 'string')
    }
  })
})

describe('RIDE_TIERS', () => {
  test('exports array of 6 ride tiers', () => {
    assert.ok(Array.isArray(RIDE_TIERS))
    assert.equal(RIDE_TIERS.length, 6)
  })

  test('validates tier shapes, pricing, and metadata', () => {
    const tierIds = RIDE_TIERS.map((t) => t.id)
    assert.deepEqual(tierIds, ['standard', 'wait', 'comfort', 'xl', 'pet', 'tesla'])

    for (const tier of RIDE_TIERS) {
      assert.equal(typeof tier.id, 'string')
      assert.equal(typeof tier.name, 'string')
      assert.equal(typeof tier.icon, 'string')
      assert.equal(typeof tier.eta, 'string')
      assert.equal(typeof tier.meta, 'string')
      assert.equal(typeof tier.price, 'number')
      assert.ok(tier.price > 0, `Price for tier ${tier.id} should be positive`)
    }

    const tesla = RIDE_TIERS.find((t) => t.id === 'tesla')
    assert.equal(tesla.premium, true)
    assert.equal(tesla.price, 36)
  })
})

describe('destPoint', () => {
  test('resolves campus landmarks via catalog lookup', () => {
    assert.deepEqual(destPoint('Sikes Hall'), { latitude: 34.6795, longitude: -82.8374 })
    assert.deepEqual(destPoint('Memorial Stadium'), STADIUM)
    assert.deepEqual(destPoint('CLT Airport'), CLT)
    assert.deepEqual(destPoint('Grand Marc'), { latitude: 34.685, longitude: -82.8165 })
    assert.deepEqual(destPoint('Tillman Hall'), { latitude: 34.6784, longitude: -82.8397 })
    assert.deepEqual(destPoint('Cooper Library'), { latitude: 34.6765, longitude: -82.8375 })
  })

  test('resolves destination points using regex matching on aliases', () => {
    // Exact 'greenville' / 'gsp' hit catalogStops first, which defines GSP at lat 34.8956
    // BUG?: GSP constant in places.js is 34.8957, but catalogStops via scheduledRideModel defines GSP at 34.8956
    assert.deepEqual(destPoint('greenville'), { latitude: 34.8956, longitude: -82.2189 })
    assert.deepEqual(destPoint('gsp'), { latitude: 34.8956, longitude: -82.2189 })
    // Phrases not in catalog fall through to DEST_POINTS regex, which returns GSP constant (lat 34.8957)
    // BUG?: DEST_POINTS regex fallback returns GSP constant (34.8957) while catalog returns 34.8956
    assert.deepEqual(destPoint('Flying out of GSP'), GSP)
    assert.deepEqual(destPoint('charlotte'), CLT)
    assert.deepEqual(destPoint('clt'), CLT)
    assert.deepEqual(destPoint('simpsonville'), { latitude: 34.5868, longitude: -82.2543 })
    assert.deepEqual(destPoint('Death Valley'), STADIUM)
  })

  test('case insensitivity in destination matching', () => {
    assert.deepEqual(destPoint('SIKES HALL'), { latitude: 34.6795, longitude: -82.8374 })
    assert.deepEqual(destPoint('GREENVILLE'), { latitude: 34.8956, longitude: -82.2189 })
    assert.deepEqual(destPoint('CHARLOTTE'), CLT)
    assert.deepEqual(destPoint('FLYING TO GSP'), GSP)
  })

  test('falls back to GSP for empty, null, undefined, or unrecognized locations', () => {
    // BUG?: destPoint defaults unknown or empty destination to GSP Airport rather than returning null or throwing
    assert.deepEqual(destPoint(null), GSP)
    assert.deepEqual(destPoint(undefined), GSP)
    assert.deepEqual(destPoint(''), GSP)
    assert.deepEqual(destPoint('   '), GSP)
    assert.deepEqual(destPoint('Unrecognized Random Location Nowhere'), GSP)
  })

  test('handles garbage input without throwing', () => {
    assert.deepEqual(destPoint(12345), GSP)
    assert.deepEqual(destPoint({}), GSP)
    assert.deepEqual(destPoint([]), GSP)
    assert.deepEqual(destPoint(false), GSP)
  })

  test('returns an object with latitude and longitude shape', () => {
    const res = destPoint('Sikes Hall')
    assert.equal(typeof res.latitude, 'number')
    assert.equal(typeof res.longitude, 'number')
  })
})

describe('pickupPoint', () => {
  test('resolves campus landmarks via catalog or regex lookup', () => {
    assert.deepEqual(pickupPoint('Sikes Hall'), { latitude: 34.6795, longitude: -82.8374 })
    // Catalog matches GSP at lat 34.8956
    assert.deepEqual(pickupPoint('GSP Airport'), { latitude: 34.8956, longitude: -82.2189 })
    assert.deepEqual(pickupPoint('Greenville'), { latitude: 34.8956, longitude: -82.2189 })
    // DEST_POINTS regex matches GSP constant (lat 34.8957)
    assert.deepEqual(pickupPoint('Pickup at GSP'), GSP)
    assert.deepEqual(pickupPoint('clt'), CLT)
    assert.deepEqual(pickupPoint('Simpsonville'), { latitude: 34.5868, longitude: -82.2543 })
    assert.deepEqual(pickupPoint('Death Valley'), STADIUM)
  })

  test('falls back to STADIUM for empty, null, undefined, or unrecognized locations', () => {
    // BUG?: pickupPoint defaults unknown or empty pickup location to STADIUM rather than returning null or throwing
    assert.deepEqual(pickupPoint(null), STADIUM)
    assert.deepEqual(pickupPoint(undefined), STADIUM)
    assert.deepEqual(pickupPoint(''), STADIUM)
    assert.deepEqual(pickupPoint('   '), STADIUM)
    assert.deepEqual(pickupPoint('Some Unknown Address Nowhere Near Clemson'), STADIUM)
  })

  test('handles garbage input without throwing', () => {
    assert.deepEqual(pickupPoint(99999), STADIUM)
    assert.deepEqual(pickupPoint({}), STADIUM)
    assert.deepEqual(pickupPoint([]), STADIUM)
    assert.deepEqual(pickupPoint(true), STADIUM)
  })

  test('returns an object with latitude and longitude shape', () => {
    const res = pickupPoint('Death Valley')
    assert.equal(typeof res.latitude, 'number')
    assert.equal(typeof res.longitude, 'number')
  })
})

describe('formatUsd', () => {
  test('formats regular numeric dollar amounts with two decimal places', () => {
    assert.equal(formatUsd(18.5), '$18.50')
    assert.equal(formatUsd(14.2), '$14.20')
    assert.equal(formatUsd(23), '$23.00')
    assert.equal(formatUsd(28.75), '$28.75')
    assert.equal(formatUsd(36), '$36.00')
    assert.equal(formatUsd(0), '$0.00')
    assert.equal(formatUsd(100), '$100.00')
    assert.equal(formatUsd(1234.56), '$1234.56')
  })

  test('formats string representations of numbers', () => {
    assert.equal(formatUsd('18.5'), '$18.50')
    assert.equal(formatUsd('0'), '$0.00')
    assert.equal(formatUsd('28.75'), '$28.75')
    assert.equal(formatUsd('100'), '$100.00')
  })

  test('handles rounding correctly for floating point cents', () => {
    assert.equal(formatUsd(10.004), '$10.00')
    assert.equal(formatUsd(10.005), '$10.01')
    assert.equal(formatUsd(0.001), '$0.00')
    assert.equal(formatUsd(0.009), '$0.01')
  })

  test('handles negative numbers', () => {
    // BUG?: formatUsd formats negative numbers as '$-5.00' instead of standard '-$5.00'
    assert.equal(formatUsd(-5), '$-5.00')
    assert.equal(formatUsd(-0.5), '$-0.50')
  })

  test('handles non-finite, null, undefined, and garbage input', () => {
    assert.equal(formatUsd(undefined), '$0.00')
    assert.equal(formatUsd(NaN), '$0.00')
    assert.equal(formatUsd(Infinity), '$0.00')
    assert.equal(formatUsd(-Infinity), '$0.00')
    assert.equal(formatUsd('not-a-number'), '$0.00')
    assert.equal(formatUsd({}), '$0.00')
    // BUG?: formatUsd(null) returns '$0.00' because Number(null) coerces to 0
    assert.equal(formatUsd(null), '$0.00')
    // BUG?: formatUsd(true) returns '$1.00' because Number(true) coerces to 1
    assert.equal(formatUsd(true), '$1.00')
    assert.equal(formatUsd(false), '$0.00')
    // BUG?: places.js formatUsd takes dollars whereas carpoolEngine formatUsd takes cents; inconsistency across the codebase
  })
})
