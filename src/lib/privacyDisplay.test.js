import test from 'node:test'
import assert from 'node:assert/strict'
import {
  approximateLatLng,
  coarsePlaceLabel,
  displayFirstName,
  maskCompletedTripForDriver,
} from './privacyDisplay.js'
import { standingFromRatings } from './standing.js'
import { isQuietNow } from './quietHours.js'
import { haversineMeters, hourlyRateCents } from './rideGeometry.js'
import { buildReceiptText } from './receiptText.js'

test('first name only', () => {
  assert.equal(displayFirstName('Ada Lovelace'), 'Ada')
  assert.equal(displayFirstName('Dr. Jane Doe'), 'Jane')
  assert.equal(displayFirstName('john@gmail.com'), 'John')
  assert.equal(displayFirstName(''), '')
})

test('coarse labels drop street numbers', () => {
  assert.equal(coarsePlaceLabel('1900 GSP Dr'), 'GSP Dr area')
  assert.equal(coarsePlaceLabel('123 College Ave, Clemson'), 'College Ave area')
  assert.equal(coarsePlaceLabel('Memorial Stadium'), 'Memorial Stadium')
})

test('approximate pin is a cell center, not the raw point', () => {
  const raw = { lat: 34.678412, lng: -82.839734 }
  const approx = approximateLatLng(raw.lat, raw.lng)
  assert.notEqual(approx.lat, raw.lat)
  assert.notEqual(approx.lng, raw.lng)
  const meters = haversineMeters(raw.lat, raw.lng, approx.lat, approx.lng)
  assert.ok(meters < 600)
})

test('completed trips mask for drivers; active trips do not', () => {
  const trip = {
    status: 'completed',
    pickup_label: '100 Calhoun Dr',
    dropoff_label: 'Memorial Stadium',
    pickup_lat: 34.68,
    pickup_lng: -82.84,
    dropoff_lat: 34.67,
    dropoff_lng: -82.83,
  }
  const masked = maskCompletedTripForDriver(trip)
  assert.equal(masked._addressMasked, true)
  assert.equal(masked.pickup_label, 'Calhoun Dr area')
  assert.notEqual(masked.pickup_lat, trip.pickup_lat)
  const live = maskCompletedTripForDriver({ ...trip, status: 'in_progress' })
  assert.equal(live.pickup_label, trip.pickup_label)
  assert.equal(live.pickup_lat, trip.pickup_lat)
})

test('quiet hours and off-the-clock', () => {
  const night = new Date('2026-09-23T23:30:00')
  const noon = new Date('2026-09-23T12:00:00')
  const scheduled = { quiet: { dnd: false, scheduleEnabled: true, start: '22:00', end: '07:00' } }
  assert.equal(isQuietNow(scheduled, night), true)
  assert.equal(isQuietNow(scheduled, noon), false)
  assert.equal(isQuietNow({ quiet: { dnd: true, scheduleEnabled: false, start: '22:00', end: '07:00' } }, noon), true)
  assert.equal(isQuietNow({ ride: true }, noon), false)
})

test('hourly rate includes drive to pickup', () => {
  const { hourlyCents, occupiedSec } = hourlyRateCents(3000, 600, 1200)
  assert.equal(occupiedSec, 1800)
  assert.equal(hourlyCents, 6000)
})

test('standing thresholds', () => {
  assert.equal(standingFromRatings(1, 1), 'good')
  assert.equal(standingFromRatings(2.9, 3), 'watch')
  assert.equal(standingFromRatings(2.4, 5), 'restricted')
  assert.equal(standingFromRatings(4.8, 12), 'good')
})

test('driver receipt hides street numbers', () => {
  const text = buildReceiptText({
    id: 'abc',
    status: 'completed',
    pickup_label: '500 Tiger Blvd',
    dropoff_label: 'GSP Airport',
    fare_cents: 7500,
    tip_cents: 300,
    completed_at: '2026-09-23T12:00:00Z',
  }, { forDriver: true })
  assert.match(text, /Tiger Blvd area/)
  assert.doesNotMatch(text, /500/)
  assert.match(text, /Tip: \$3\.00/)
  assert.match(text, /Total: \$78\.00/)
})
