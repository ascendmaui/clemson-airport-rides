import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approximateLatLng,
  coarseAreaLabel,
  displayFirstName,
  maskCompletedTripForDriver,
  maskTripLocationsForDriver,
} from './privacyDisplay.js'

test('displayFirstName keeps only the given name', () => {
  assert.equal(displayFirstName('Jordan Lee'), 'Jordan')
  assert.equal(displayFirstName('Dr. Maya Chen'), 'Maya')
  assert.equal(displayFirstName('ada.lovelace@clemson.edu'), 'ada')
  assert.equal(displayFirstName(''), '')
})

test('coarse labels drop street addresses', () => {
  assert.equal(coarseAreaLabel('123 Main Street, Clemson, SC 29631'), 'Clemson area')
  assert.equal(coarseAreaLabel('Memorial Stadium'), 'Clemson · Memorial Stadium')
  assert.equal(coarseAreaLabel('1900 GSP Dr'), 'Greenville · GSP Airport')
  assert.equal(coarseAreaLabel('88 Abbey Road'), 'Trip completed')
  assert.equal(coarseAreaLabel(''), 'Trip completed')
})

test('approximateLatLng snaps to a neighborhood grid', () => {
  const a = approximateLatLng(34.67881, -82.84302)
  const b = approximateLatLng(34.6794, -82.8391)
  assert.deepEqual(a, { lat: 34.68, lng: -82.84, precision: 'neighborhood' })
  assert.equal(a.lat, b.lat)
  assert.equal(a.lng, b.lng)
  assert.equal(approximateLatLng(null, null), null)
})

test('completed trips are masked and active trips stay exact', () => {
  const trip = {
    status: 'completed',
    pickup_label: '123 Main Street, Clemson',
    dropoff_label: 'Memorial Stadium',
    pickup_lat: 34.67881,
    pickup_lng: -82.84302,
    dropoff_lat: 34.6788,
    dropoff_lng: -82.843,
    rider_note: 'meet at the blue door',
    stops: [{ label: '456 Oak St' }],
    metadata: {
      route_polyline: 'secret',
      distance_m: 1200,
      participants: [{ display_name: 'Jordan Lee', fare_cents: 1000 }],
    },
  }
  const masked = maskCompletedTripForDriver(trip)
  assert.equal(masked.pickup_label, 'Clemson area')
  assert.equal(masked.dropoff_label, 'Clemson · Memorial Stadium')
  assert.equal(masked.pickup_lat, 34.68)
  assert.equal(masked.rider_note, null)
  assert.deepEqual(masked.stops, [])
  assert.equal(masked.metadata.route_polyline, undefined)
  assert.equal(masked.metadata.participants[0].display_name, 'Jordan')
  assert.equal(JSON.stringify(masked).includes('Main Street'), false)
  assert.equal(JSON.stringify(masked).includes('Lee'), false)

  const active = maskTripLocationsForDriver(
    { ...trip, status: 'in_progress', completed_at: null },
    { completed: false },
  )
  assert.equal(active.pickup_label, '123 Main Street, Clemson')
  assert.equal(active.pickup_lat, 34.67881)
})
