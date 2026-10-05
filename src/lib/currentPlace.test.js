import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCATION_DENIED_MESSAGE,
  LOCATION_MISSING_MESSAGE,
  LOCATION_TIMEOUT_MESSAGE,
  LOCATION_UNAVAILABLE_MESSAGE,
  geolocationFailureMessage,
  readBrowserPosition,
} from './currentPlace.js'

function position(lat, lng) {
  return { coords: { latitude: lat, longitude: lng, heading: 12 } }
}

function geoError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

test('geolocationFailureMessage never returns the raw browser denial string', () => {
  assert.equal(geolocationFailureMessage(geoError(1, 'User denied Geolocation')), LOCATION_DENIED_MESSAGE)
  assert.equal(geolocationFailureMessage({ code: 1, message: '' }), LOCATION_DENIED_MESSAGE)
  assert.equal(geolocationFailureMessage(geoError(2, 'Position unavailable')), LOCATION_UNAVAILABLE_MESSAGE)
  assert.equal(geolocationFailureMessage(geoError(3, 'Timeout expired')), LOCATION_TIMEOUT_MESSAGE)
  assert.equal(geolocationFailureMessage(new Error('User denied Geolocation')), LOCATION_DENIED_MESSAGE)
})

test('readBrowserPosition tells the rider to type an address when permission is denied or dismissed', async () => {
  let calls = 0
  const geolocation = {
    getCurrentPosition(_ok, fail) {
      calls += 1
      fail(geoError(1, 'User denied Geolocation'))
    },
  }
  await assert.rejects(
    () => readBrowserPosition(geolocation),
    (err) => {
      assert.equal(err.message, LOCATION_DENIED_MESSAGE)
      assert.equal(err.message.includes('User denied'), false)
      return true
    },
  )
  assert.equal(calls, 1)
})

test('readBrowserPosition falls back to a coarse fix when precise GPS times out', async () => {
  const options = []
  const geolocation = {
    getCurrentPosition(ok, fail, opts) {
      options.push(opts)
      if (opts.enableHighAccuracy) fail(geoError(3, 'Timeout expired'))
      else ok(position(34.6834, -82.8374))
    },
  }
  const fix = await readBrowserPosition(geolocation)
  assert.deepEqual(options.map((opts) => opts.enableHighAccuracy), [true, false])
  assert.equal(fix.lat, 34.6834)
  assert.equal(fix.lng, -82.8374)
})

test('readBrowserPosition explains a missing geolocation API', async () => {
  await assert.rejects(() => readBrowserPosition(null), (err) => err.message === LOCATION_MISSING_MESSAGE)
})
