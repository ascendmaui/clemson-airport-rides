import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_PARTICIPANTS,
  cors,
  json,
  parseBody,
  publicRideSummary,
  randomToken,
  splitFares,
  stopLatLng,
} from './friendRideCore.js'

test('MAX_PARTICIPANTS is capped at 5', () => {
  assert.equal(MAX_PARTICIPANTS, 5)
})

test('json helper writes status, headers, and stringified body', () => {
  const headers = {}
  let ended = false
  let responseData = ''

  const res = {
    statusCode: 200,
    setHeader: (k, v) => {
      headers[k] = v
    },
    end: (str) => {
      ended = true
      responseData = str
    },
  }

  json(res, 201, { success: true })
  assert.equal(res.statusCode, 201)
  assert.equal(headers['Content-Type'], 'application/json')
  assert.equal(headers['Access-Control-Allow-Origin'], '*')
  assert.equal(ended, true)
  assert.deepEqual(JSON.parse(responseData), { success: true })
})

test('cors handles OPTIONS preflight and non-preflight requests', () => {
  let preflightEnded = false
  const preflightRes = {
    statusCode: 200,
    setHeader: () => {},
    end: () => {
      preflightEnded = true
    },
  }

  const handled = cors({ method: 'OPTIONS' }, preflightRes)
  assert.equal(handled, true)
  assert.equal(preflightRes.statusCode, 204)
  assert.equal(preflightEnded, true)

  const notHandled = cors({ method: 'POST' }, {})
  assert.equal(notHandled, false)
})

test('parseBody parses strings and handles malformed JSON cleanly', () => {
  assert.deepEqual(parseBody({ body: { key: 'value' } }), { body: { key: 'value' } })
  assert.deepEqual(parseBody({ body: '{"token":"xyz"}' }), { body: { token: 'xyz' } })
  assert.deepEqual(parseBody({ body: '' }), { body: {} })
  assert.deepEqual(parseBody({ body: null }), { body: {} })

  const malformed = parseBody({ body: '{ broken json ' })
  assert.equal(malformed.error, 'Invalid JSON')
})

test('randomToken generates unique alphanumeric tokens of requested length', () => {
  const tok1 = randomToken(16)
  const tok2 = randomToken(16)
  assert.equal(tok1.length, 16)
  assert.notEqual(tok1, tok2)

  const shortTok = randomToken(8)
  assert.equal(shortTok.length, 8)
})

test('splitFares evenly divides cents and distributes remainder pennies', () => {
  // Empty
  assert.deepEqual(splitFares(1000, []), [])

  // Single participant
  assert.deepEqual(splitFares(1500, ['p1']), [1500])

  // Even split with clean divisibility: $10.00 / 2 = $5.00 each
  assert.deepEqual(splitFares(1000, ['p1', 'p2'], 'even'), [500, 500])

  // Remainder cents distribution: $10.00 / 3 = 333 + 333 + 333 = 999 (+1 cent to p1)
  assert.deepEqual(splitFares(1000, ['p1', 'p2', 'p3'], 'even'), [334, 333, 333])

  // Remainder cents distribution: $10.00 / 4 = 250 each
  assert.deepEqual(splitFares(1000, ['p1', 'p2', 'p3', 'p4'], 'even'), [250, 250, 250, 250])

  // Remainder cents distribution: $10.02 / 4 = 250 + 2 = 251, 251, 250, 250
  assert.deepEqual(splitFares(1002, ['p1', 'p2', 'p3', 'p4'], 'even'), [251, 251, 250, 250])
})

test('splitFares divides proportionally when segment weights are provided', () => {
  // 1:2 ratio on $30.00 (3000 cents) -> 1000 and 2000
  const weights = [1, 2]
  const shares = splitFares(3000, ['p1', 'p2'], 'by_distance', weights)
  assert.deepEqual(shares, [1000, 2000])

  // Zero sum weights fallback to even
  const zeroShares = splitFares(2000, ['p1', 'p2'], 'by_distance', [0, 0])
  assert.deepEqual(zeroShares, [1000, 1000])
})

test('stopLatLng extracts latitude and longitude from varied stop shapes', () => {
  assert.deepEqual(stopLatLng({ lat: 34.68, lng: -82.83, label: 'Tillman' }), {
    lat: 34.68,
    lng: -82.83,
    label: 'Tillman',
  })
  assert.deepEqual(stopLatLng({ latitude: 34.68, longitude: -82.83 }), {
    lat: 34.68,
    lng: -82.83,
    label: '34.6800, -82.8300',
  })

  // Missing or non-finite coordinates
  assert.equal(stopLatLng(null), null)
  assert.equal(stopLatLng({}), null)
  assert.equal(stopLatLng({ lat: NaN, lng: -82.83 }), null)
  assert.equal(stopLatLng({ lat: '34.68', lng: 'invalid' }), null)
})

test('publicRideSummary sanitizes ride lobby and masks emails', () => {
  const ride = {
    id: 'ride_100',
    token: 'token_secret',
    status: 'booked',
    split_mode: 'even',
    total_fare_cents: 2400,
    organizer_id: 'user_org',
    trip_id: 'trip_100',
  }

  const participants = [
    {
      id: 'part_1',
      display_name: 'John Matveyev',
      email: 'john@clemson.edu',
      user_id: 'user_org',
      fare_cents: 1200,
      status: 'paid',
      pickup: { label: '105 College Ave', lat: 34.683, lng: -82.836 },
      dropoff: { label: 'GSP Airport', lat: 34.895, lng: -82.218 },
    },
  ]

  const summary = publicRideSummary(ride, participants)
  assert.equal(summary.id, 'ride_100')
  assert.equal(summary.token, 'token_secret')
  assert.equal(summary.status, 'booked')

  assert.equal(summary.participants[0].display_name, 'John Matveyev')
  // Email is masked
  assert.equal(summary.participants[0].email, 'j***@clemson.edu')
  // Sensitive card fields are nulled
  assert.equal(summary.participants[0].has_card, null)
})
