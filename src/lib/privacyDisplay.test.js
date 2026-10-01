import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPROX_GRID_METERS,
  AREA_RADIUS_METERS,
  approximateLatLng,
  approximateTripPin,
  coarseAreaLabel,
  coarsePlaceLabel,
  displayFirstName,
  driverFacingTrip,
  maskActiveAwareTrip,
  maskCompletedTripForDriver,
  maskTripLocationsForDriver,
  maskedRouteSummary,
} from './privacyDisplay.js'

test('privacyDisplay: constants have expected values', () => {
  assert.equal(APPROX_GRID_METERS, 400)
  assert.equal(AREA_RADIUS_METERS, 450)
})

test('displayFirstName: extracts first name and cleans punctuation', () => {
  assert.equal(displayFirstName('John Doe'), 'John')
  assert.equal(displayFirstName('Alice'), 'Alice')
  assert.equal(displayFirstName('Mary-Jane Watson'), 'Mary-Jane')
  assert.equal(displayFirstName("O'Connor"), "O'Connor")
  assert.equal(displayFirstName('   Tiger   Woods  '), 'Tiger')
  assert.equal(displayFirstName(''), 'Rider')
  assert.equal(displayFirstName(null), 'Rider')
  assert.equal(displayFirstName(undefined), 'Rider')
  assert.equal(displayFirstName(123), 'Rider')
  assert.equal(displayFirstName('', 'Clemson Tiger'), 'Clemson Tiger')
  assert.equal(displayFirstName(null, 'Guest'), 'Guest')
})

test('approximateLatLng: snaps coordinates to 0.01 degree neighborhood grid', () => {
  const coord = approximateLatLng(34.6834, -82.8374)
  assert.ok(coord)
  assert.equal(coord.lat, 34.68)
  assert.equal(coord.lng, -82.84)
  assert.equal(coord.precision, 'neighborhood')

  // Boundary checks and invalid inputs
  assert.equal(approximateLatLng(null, -82.8374), null)
  assert.equal(approximateLatLng(34.6834, null), null)
  assert.equal(approximateLatLng('', ''), null)
  assert.equal(approximateLatLng(NaN, -82.83), null)
  assert.equal(approximateLatLng(34.68, Infinity), null)
  assert.equal(approximateLatLng(95.0, 10.0), null) // Latitude > 90
  assert.equal(approximateLatLng(10.0, -185.0), null) // Longitude < -180
})

test('approximateTripPin: centers coordinates on grid cells', () => {
  const pin = approximateTripPin(34.6834, -82.8374, 400)
  assert.ok(pin)
  assert.equal(typeof pin.lat, 'number')
  assert.equal(typeof pin.lng, 'number')
  assert.ok(Number.isFinite(pin.lat))
  assert.ok(Number.isFinite(pin.lng))

  // Repeated calls on same coordinates produce deterministic pin
  const pin2 = approximateTripPin(34.6834, -82.8374, 400)
  assert.deepEqual(pin, pin2)

  // Invalid inputs return null
  assert.equal(approximateTripPin(NaN, -82.83), null)
  assert.equal(approximateTripPin(undefined, -82.83), null)
  assert.equal(approximateTripPin('not-a-number', -82.83), null)
})

test('coarseAreaLabel: categorizes spots and regional cities', () => {
  assert.equal(coarseAreaLabel('Memorial Stadium Gate 1'), 'Clemson · Memorial Stadium')
  assert.equal(coarseAreaLabel('Death Valley south lot'), 'Clemson · Memorial Stadium')
  assert.equal(coarseAreaLabel('Downtown Clemson on College Ave'), 'Clemson · downtown')
  assert.equal(coarseAreaLabel('Cooper Library, Clemson, SC'), 'Clemson · campus')
  assert.equal(coarseAreaLabel('Tillman Hall'), 'Clemson · campus')
  assert.equal(coarseAreaLabel('Greenville-Spartanburg International Airport (GSP)'), 'Greenville · GSP Airport')
  assert.equal(coarseAreaLabel('CLT Airport Departures'), 'Charlotte · CLT Airport')
  assert.equal(coarseAreaLabel('Charlotte Douglas Terminal'), 'Charlotte · CLT Airport')
  assert.equal(coarseAreaLabel('123 Main St, Seneca, SC'), 'Seneca area')
  assert.equal(coarseAreaLabel('Greenville Downtown'), 'Greenville area')
  assert.equal(coarseAreaLabel('Central railway'), 'Central area')
  assert.equal(coarseAreaLabel('Pendleton square'), 'Pendleton area')
  assert.equal(coarseAreaLabel('Random Unknown Location 999'), 'Trip completed')
  assert.equal(coarseAreaLabel(''), 'Trip completed')
  assert.equal(coarseAreaLabel(null), 'Trip completed')
})

test('coarsePlaceLabel: strips house numbers and unit numbers', () => {
  assert.equal(coarsePlaceLabel('123 College Ave, Clemson, SC'), 'College Ave area')
  assert.equal(coarsePlaceLabel('456 Old Greenville Highway Apt 2B, Clemson, SC'), 'Old Greenville Highway area')
  assert.equal(coarsePlaceLabel('Memorial Stadium'), 'Memorial Stadium')
  assert.equal(coarsePlaceLabel(''), 'Nearby area')
  assert.equal(coarsePlaceLabel(null), 'Nearby area')
})

test('maskTripLocationsForDriver: protects completed trip privacy while leaving open trips intact', () => {
  const openTrip = {
    id: 'trip-1',
    status: 'in_progress',
    pickup_label: '100 Douthit Hills Dr, Clemson, SC',
    dropoff_label: 'Memorial Stadium',
    pickup_lat: 34.6789,
    pickup_lng: -82.8345,
    dropoff_lat: 34.6780,
    dropoff_lng: -82.8430,
    rider_note: 'Standing by the bench with orange umbrella',
    stops: [{ label: 'Stop 1' }],
    metadata: {
      kind: 'carpool',
      distance_m: 2400,
      private_secret: 'do_not_leak',
      participants: [
        { id: 'u1', fare_cents: 1200, display_name: 'Dr. Bruce Banner' },
      ],
    },
  }

  // When trip is in progress, no masking is applied
  const unmasked = maskTripLocationsForDriver(openTrip)
  assert.equal(unmasked.pickup_label, '100 Douthit Hills Dr, Clemson, SC')
  assert.equal(unmasked.rider_note, 'Standing by the bench with orange umbrella')
  assert.equal(unmasked.stops.length, 1)

  // When trip is completed, privacy masking is strictly applied
  const completedTrip = { ...openTrip, status: 'completed', completed_at: '2026-09-25T14:30:00Z' }
  const masked = maskTripLocationsForDriver(completedTrip)

  assert.equal(masked.location_masked, true)
  assert.equal(masked.location_precision, 'neighborhood')
  assert.equal(masked.pickup_label, 'Clemson · campus')
  assert.equal(masked.dropoff_label, 'Clemson · Memorial Stadium')
  assert.equal(masked.rider_note, null)
  assert.deepEqual(masked.stops, [])
  assert.equal(masked.pickup_lat, 34.68)
  assert.equal(masked.pickup_lng, -82.83)

  // Metadata retains whitelist keys and scrubs others
  assert.equal(masked.metadata.kind, 'carpool')
  assert.equal(masked.metadata.distance_m, 2400)
  assert.equal(masked.metadata.private_secret, undefined)
  assert.equal(masked.metadata.participants[0].display_name, 'Bruce')
})

test('maskCompletedTripForDriver: forces masking regardless of status field', () => {
  const trip = {
    id: 'trip-2',
    status: 'accepted',
    pickup_label: 'Tillman Hall',
    dropoff_label: 'Greenville Airport GSP',
    pickup_lat: 34.6789,
    pickup_lng: -82.8345,
  }
  const masked = maskCompletedTripForDriver(trip)
  assert.equal(masked.location_masked, true)
  assert.equal(masked.pickup_label, 'Clemson · campus')
  assert.equal(masked.dropoff_label, 'Greenville · GSP Airport')
})

test('maskActiveAwareTrip: provides approximate grid pins on completed trips', () => {
  const completedTrip = {
    id: 'trip-3',
    status: 'completed',
    pickup_label: '123 College Ave, Clemson, SC',
    dropoff_label: '456 Tiger Blvd, Clemson, SC',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.6900,
    dropoff_lng: -82.8400,
  }
  const masked = maskActiveAwareTrip(completedTrip)
  assert.equal(masked._addressMasked, true)
  assert.equal(masked._areaRadiusM, 450)
  assert.equal(masked.pickup_label, 'College Ave area')
  assert.equal(typeof masked.pickup_lat, 'number')
  assert.equal(typeof masked.pickup_lng, 'number')

  // Non-completed trip is unmodified
  const searchingTrip = { ...completedTrip, status: 'searching' }
  const unchanged = maskActiveAwareTrip(searchingTrip)
  assert.equal(unchanged._addressMasked, undefined)
})

test('driverFacingTrip: masks trip when viewer is the assigned driver', () => {
  const trip = {
    id: 'trip-4',
    status: 'completed',
    driver_id: 'drv-123',
    pickup_label: '10 Bowman Field, Clemson, SC',
    pickup_lat: 34.68,
    pickup_lng: -82.83,
  }
  const masked = driverFacingTrip(trip, 'drv-123')
  assert.equal(masked._addressMasked, true)

  const otherDriver = driverFacingTrip(trip, 'drv-999')
  assert.equal(otherDriver._addressMasked, undefined)
})

test('maskedRouteSummary: formats origin to destination with deduplication', () => {
  assert.equal(
    maskedRouteSummary('Clemson · campus', 'Greenville · GSP Airport'),
    'Clemson · campus → Greenville · GSP Airport',
  )
  assert.equal(
    maskedRouteSummary('Trip completed', 'Trip completed'),
    'Trip completed',
  )
  assert.equal(maskedRouteSummary(null, null), 'Trip completed')
  assert.equal(maskedRouteSummary('Clemson · campus', null), 'Clemson · campus → Trip completed')
})
