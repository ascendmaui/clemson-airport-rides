import test from 'node:test'
import assert from 'node:assert/strict'
import { airportTripContext, flightFromBody, normalizeFlight, tripFlight } from './airportContext.js'

test('flight numbers normalize to airline code + number, names map to codes', () => {
  assert.deepEqual(normalizeFlight({ number: 'dl1234', time: '6:05' }).flight,
    { number: 'DL 1234', airlineCode: 'DL', airline: 'Delta', time: '06:05' })
  assert.equal(normalizeFlight('Southwest 22').flight.number, 'WN 22')
  assert.equal(normalizeFlight({ number: 'B6-901' }).flight.airline, 'JetBlue')
  assert.equal(normalizeFlight({ number: 'XQ 77' }).flight.airline, null)
  assert.deepEqual(normalizeFlight({}), { flight: null })
  assert.equal(normalizeFlight({ number: 'tomorrow' }).code, 'invalid_flight_number')
  assert.equal(normalizeFlight({ time: '24:10' }).code, 'invalid_flight_time')
})

test('booking input is optional and validated', () => {
  assert.deepEqual(flightFromBody({}), { flight: null, column: null })
  assert.equal(flightFromBody({ flight: { number: 'AA 12', time: '' } }).column, 'AA 12')
  assert.equal(flightFromBody({ flightNumber: 'UA9', flightTime: '07:30' }).flight.time, '07:30')
  assert.equal(flightFromBody({ flight: { number: '???' } }).code, 'invalid_flight_number')
})

test('GSP, CLT and ATL trips get airport context; other trips get none', () => {
  assert.equal(airportTripContext({ dropoff_label: 'Clemson Downtown', pickup_label: 'Cooper Library' }), null)
  const gsp = airportTripContext({ pickup_label: 'Clemson', dropoff_label: 'GSP Airport', metadata: { airport: 'GSP' } })
  assert.equal(gsp.code, 'GSP')
  assert.equal(gsp.direction, 'to')
  assert.equal(gsp.line, 'GSP · Departures')
  const clt = airportTripContext({ pickup_label: 'Charlotte Douglas (CLT)', dropoff_label: 'Cooper Library', flight: 'AA 1550' })
  assert.equal(clt.direction, 'from')
  assert.equal(clt.line, 'CLT · Arrivals · American AA 1550')
})

test('ATL shows the check-in side by airline and the flight time', () => {
  const delta = airportTripContext({ dropoff_label: 'ATL Airport', metadata: { flight: { number: 'DL 1234', time: '18:05' } } })
  assert.equal(delta.terminal, 'Domestic South')
  assert.equal(delta.line, 'ATL · Domestic South · Departures · Delta DL 1234 · departs 6:05 PM')
  const other = airportTripContext({ dropoff_label: 'Hartsfield-Jackson Atlanta (ATL)', metadata: { flight: { number: 'WN 10' } } })
  assert.equal(other.terminal, 'Domestic North')
  // No flight: no terminal guess.
  assert.equal(airportTripContext({ dropoff_label: 'ATL Airport' }).terminal, null)
})

test('metadata.flight wins over the text column', () => {
  assert.equal(tripFlight({ flight: 'AA 1', metadata: { flight: { number: 'DL 2' } } }).number, 'DL 2')
  assert.equal(tripFlight({ flight: 'garbage!!' }), null)
})
