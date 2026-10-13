import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalFlightNumber, riderFlightView, tripFlightStatus, waveAlertCopy, waveAlertDue, waveWorthAlert } from './flightStatus.js'

test('canonical flight numbers', () => {
  assert.equal(canonicalFlightNumber('DL1234'), 'DL 1234')
  assert.equal(canonicalFlightNumber('aa 55'), 'AA 55')
  assert.equal(canonicalFlightNumber('???'), null)
})

test('trip flight status prefers actual, then estimated, never invents', () => {
  const s = tripFlightStatus({ flight_number: 'DL 1234', scheduled_at: '2026-10-12T18:00:00.000Z', estimated_at: '2026-10-12T18:25:00.000Z', provider: 'aerodatabox' }, 'GSP', new Date('2026-10-12T17:00:00Z'))
  assert.equal(s.landing_at, '2026-10-12T18:25:00.000Z')
  assert.equal(s.landed, false)
  assert.equal(s.curb_ready_at, '2026-10-12T18:37:00.000Z')
  const landed = tripFlightStatus({ flight_number: 'DL 1234', scheduled_at: '2026-10-12T18:00:00.000Z', actual_at: '2026-10-12T18:10:00.000Z', provider: 'x' }, 'GSP')
  assert.equal(landed.landing_at, '2026-10-12T18:10:00.000Z')
  assert.equal(landed.landed, true)
  assert.equal(tripFlightStatus(null, 'GSP'), null)
})

test('rider view: arrivals pickup shows adjusted landing and waiting copy', () => {
  const trip = {
    pickup_label: 'GSP Airport', dropoff_label: 'Clemson campus', flight: 'DL 1234',
    metadata: { flight: { number: 'DL 1234', time: '14:00' }, flight_status: { number: 'DL 1234', scheduled_at: '2026-10-12T18:00:00.000Z', landing_at: '2026-10-12T18:25:00.000Z', landed: false } },
  }
  const v = riderFlightView(trip, 'accepted')
  assert.equal(v.line, 'DL 1234 · Landing 2:25 PM (was 2:00 PM)')
  assert.equal(v.waitingTitle, null)
  assert.equal(riderFlightView(trip, 'arrived').waitingTitle, 'Your driver is waiting at Arrivals')
  assert.equal(riderFlightView({ ...trip, pickup_label: 'Clemson campus', dropoff_label: 'GSP Airport' }, 'arrived'), null)
})

test('rider view without provider data keeps the rider-entered line only', () => {
  const v = riderFlightView({ pickup_label: 'GSP Airport', dropoff_label: 'Clemson', metadata: { flight: { number: 'DL 1234', time: '14:00' } } }, 'arrived')
  assert.equal(v.line, 'Delta DL 1234 · lands 2:00 PM')
  assert.equal(v.waitingTitle, 'Your driver is waiting at Arrivals')
})

test('wave alerts: weighted, due ~20 min before, copy names the cell lot', () => {
  const wave = { airport: 'GSP', wave_start: '2026-10-12T18:20:00Z', wave_end: '2026-10-12T18:40:00Z', stage_at: '2026-10-12T18:00:00Z', flights: 2, booked_pickups: 1, score: 5, data_quality: 'live' }
  assert.equal(waveWorthAlert(wave), true)
  assert.equal(waveWorthAlert({ flights: 2, booked_pickups: 0, score: 2 }), false)
  assert.equal(waveWorthAlert({ flights: 4, booked_pickups: 0, score: 4 }), true)
  assert.equal(waveAlertDue(wave, new Date('2026-10-12T17:56:00Z')), true)
  assert.equal(waveAlertDue(wave, new Date('2026-10-12T17:40:00Z')), false)
  const copy = waveAlertCopy(wave)
  assert.equal(copy.title, 'Flights landing at GSP')
  assert.match(copy.body, /2 flights · 1 booked pickup land 2:20 PM–2:40 PM\. Stage at the GSP cell lot by 2:00 PM\./)
})
