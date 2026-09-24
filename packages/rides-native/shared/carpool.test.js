import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NEIGHBORHOODS,
  NEIGHBORHOOD_GROUPS,
  clusterOf,
  defaultCarpoolEnds,
  formatUsd,
  hotNeighborhoods,
  neighborhoodsInGroup,
  parseCarpoolToken,
  pitchQuote,
  searchNeighborhoods,
} from './carpool.js'
import { liveCarpoolQuote, splitRows } from './split.js'
import { capacityMessage, offerCapacity, vehicleMaxSeats } from './vehicle.js'

const PEAK = new Date('2026-09-26T22:00:00-04:00')

test('clusters Grand Marc, College Ave, stadium, bars, and housing', () => {
  assert.equal(clusterOf({ label: 'Grand Mark apartments', lat: 0, lng: 0 })?.id, 'grand-marc')
  assert.equal(clusterOf({ label: 'Downtown / College', lat: 34.68, lng: -82.83 })?.id, 'college-ave')
  assert.equal(clusterOf({ label: 'Death Valley', lat: 34.68, lng: -82.84 })?.id, 'memorial-stadium')
  assert.equal(clusterOf({ label: "Nick's", lat: 34.68, lng: -82.83 })?.id, 'nicks')
  assert.equal(clusterOf({ label: 'The Reserve at Clemson', lat: 34.65, lng: -82.81 })?.id, 'the-reserve')
  assert.equal(searchNeighborhoods('esso')[0]?.id, 'esso')
  assert.equal(searchNeighborhoods('lofts')[0]?.id, 'clemson-lofts')

  const grouped = new Set(NEIGHBORHOOD_GROUPS.flatMap((group) => group.ids))
  assert.equal(grouped.size, NEIGHBORHOODS.length)
  for (const row of NEIGHBORHOODS) assert.equal(grouped.has(row.id), true)
  assert.equal(neighborhoodsInGroup('bars').some((row) => row.id === 'tiger-town'), true)
  assert.equal(neighborhoodsInGroup('housing').some((row) => row.id === 'grand-marc'), true)
  assert.equal(hotNeighborhoods().some((row) => row.id === 'memorial-stadium'), true)
})

test('peak hop stays in the $30–$40 solo and $10–$15 full-car band', () => {
  const { pickup, dropoff } = defaultCarpoolEnds()
  const pitch = pitchQuote({ pickup, dropoff, at: PEAK, displayName: 'You' })
  assert.ok(pitch.soloCents >= 3000 && pitch.soloCents <= 4000, formatUsd(pitch.soloCents))
  assert.ok(pitch.fullShareCents >= 1000 && pitch.fullShareCents <= 1500, formatUsd(pitch.fullShareCents))
  assert.equal(pitch.savingsCents, pitch.soloCents - pitch.fullShareCents)
  assert.ok(pitch.savingsCents > 0)
  assert.equal(pitch.window, 'peak_night')
})

test('parses a carpool link or bare token', () => {
  assert.equal(parseCarpoolToken('https://clemson-airport-rides.vercel.app/carpool/abc123xyz'), 'abc123xyz')
  assert.equal(parseCarpoolToken('abc123xyz'), 'abc123xyz')
  assert.equal(parseCarpoolToken('not a code'), '')
})

test('vehicle seats cap the offer, tailgate can use six', () => {
  assert.equal(vehicleMaxSeats({ seats: 7, make: 'Chevy', model: 'Suburban' }), 7)
  assert.equal(vehicleMaxSeats({ make: 'Toyota', model: 'Highlander' }), 7)
  assert.equal(vehicleMaxSeats({ make: 'Honda', model: 'Civic' }), 4)
  const suv = { seats: 7, make: 'Chevy', model: 'Suburban', plate: 'TIGER1' }
  assert.equal(offerCapacity(suv, { tailgate: false })?.cap, 4)
  assert.equal(offerCapacity(suv, { tailgate: true })?.cap, 6)
  assert.match(capacityMessage(7, { hasVehicle: true }), /seats up to 7/)
  assert.match(capacityMessage(4, { hasVehicle: false }), /Add your vehicle/)
})

test('split rows come from each rider hop, not solo divided by headcount', () => {
  const { pickup, dropoff } = defaultCarpoolEnds()
  const ride = {
    participants: [
      { id: 'a', display_name: 'Ada', pickup, dropoff, is_self: true },
      { id: 'b', display_name: 'Bea', pickup, dropoff },
    ],
  }
  const quote = liveCarpoolQuote(ride)
  assert.equal(quote.riderCount, 2)
  const rows = splitRows(ride)
  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.ok(row.shareCents < row.soloCents)
    assert.equal(row.savingsCents, row.soloCents - row.shareCents)
  }
})
