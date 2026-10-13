import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FORM_1099_INFO_URL,
  MILEAGE_ESTIMATE_NOTE,
  MILEAGE_RATE_CONFIG,
  STRIPE_1099_NOTE,
  STRIPE_CONNECT_1099_URL,
  TAX_NOT_ADVICE,
  buildYearEndCsv,
  buildYearEndPacket,
  buildYearEndPdf,
  mileageFromTrip,
  milesFromMeters,
  normalizeMileageRates,
  rateForDate,
} from './driverTaxMileage.js'

const TZ = 'America/New_York'

test('on-trip miles prefer the routed trip distance and skip en route when it was not captured', () => {
  const row = mileageFromTrip({
    status: 'completed',
    metadata: { route_distance_m: 1609.344 },
    pickup_lat: 34.68,
    pickup_lng: -82.84,
    dropoff_lat: 34.7,
    dropoff_lng: -82.8,
  })
  assert.equal(row.onTripMiles, 1)
  assert.equal(row.onTripSource, 'routed')
  assert.equal(row.enrouteMiles, null)
  assert.equal(row.enrouteSource, 'unavailable')
  assert.equal(row.deductibleMiles, 1)
})

test('straight-line on-trip miles are used only when no routed distance exists', () => {
  const row = mileageFromTrip({
    status: 'completed',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.6834,
    dropoff_lng: -82.8374,
  })
  assert.equal(row.onTripSource, 'unavailable')
  const apart = mileageFromTrip({
    status: 'completed',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.6934,
    dropoff_lng: -82.8374,
  })
  assert.equal(apart.onTripSource, 'straight_line')
  assert.ok(apart.onTripMiles > 0.6 && apart.onTripMiles < 0.8)
  assert.equal(milesFromMeters(1609.344 * 2), 2)
})

test('en-route miles use a routed pickup distance, otherwise the accept location', () => {
  const routed = mileageFromTrip({
    status: 'completed',
    metadata: { route_distance_m: 3218.688, enroute_distance_m: 804.672 },
  })
  assert.equal(routed.onTripMiles, 2)
  assert.equal(routed.enrouteMiles, 0.5)
  assert.equal(routed.enrouteSource, 'routed')
  assert.equal(routed.deductibleMiles, 2.5)

  const captured = mileageFromTrip({
    status: 'completed',
    metadata: { distance_m: 1609.344 },
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
  }, { captureEnroute: true, driverLat: 34.6934, driverLng: -82.8374 })
  assert.equal(captured.enrouteSource, 'straight_line')
  assert.ok(captured.enrouteMiles > 0.6 && captured.enrouteMiles < 0.8)

  const missed = mileageFromTrip({
    status: 'completed',
    metadata: { distance_m: 1609.344 },
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
  }, { captureEnroute: false, driverLat: 34.6934, driverLng: -82.8374 })
  assert.equal(missed.enrouteSource, 'unavailable')
})

test('a no-show keeps en-route miles and does not treat the booked route as on-trip', () => {
  const row = mileageFromTrip({
    status: 'cancelled_wait',
    metadata: { route_distance_m: 5000, enroute_distance_m: 1609.344 },
  })
  assert.equal(row.onTripSource, 'unavailable')
  assert.equal(row.onTripMiles, null)
  assert.equal(row.enrouteMiles, 1)
  assert.equal(row.deductibleMiles, 1)
})

test('year packet splits miles, sums payouts, and estimates the mid-year IRS rates', () => {
  const packet = buildYearEndPacket({
    year: 2026,
    timeZone: TZ,
    rates: MILEAGE_RATE_CONFIG,
    grossEarningsCents: 11000,
    tipsCents: 500,
    platformFeeCents: 2200,
    driverNetCents: 8800,
    earningsTripCount: 2,
    payoutRows: [
      { trip_id: 'spring', status: 'paid', amount_cents: 4000 },
      { trip_id: 'summer', status: 'pending', amount_cents: 1000 },
    ],
    trips: [
      {
        id: 'spring',
        status: 'completed',
        completedAt: '2026-03-15T15:00:00-04:00',
        pickupLabel: 'Campus',
        dropoffLabel: 'GSP',
        metadata: { route_distance_m: 16093.44, enroute_distance_m: 1609.344 },
      },
      {
        id: 'summer',
        status: 'completed',
        completedAt: '2026-08-02T15:00:00-04:00',
        pickupLabel: 'Library',
        dropoffLabel: 'Downtown',
        metadata: { route_distance_m: 3218.688 },
      },
      {
        id: 'next',
        status: 'completed',
        completedAt: '2027-01-01T00:30:00-05:00',
        metadata: { route_distance_m: 16093.44 },
      },
    ],
  })

  assert.equal(packet.tripCount || packet.trips.length, 2)
  assert.equal(packet.trips.length, 2)
  assert.equal(packet.grossEarningsCents, 11000)
  assert.equal(packet.tipsCents, 500)
  assert.equal(packet.platformFeeCents, 2200)
  assert.equal(packet.payoutsCents, 4000)
  assert.equal(packet.pendingPayoutCents, 1000)
  assert.equal(packet.onTripMiles, 12)
  assert.equal(packet.enrouteMiles, 1)
  assert.equal(packet.deductibleMiles, 13)
  assert.equal(packet.enrouteUntrackedTrips, 1)
  assert.equal(packet.estimate, true)
  const spring = packet.trips.find((trip) => trip.id === 'spring')
  const summer = packet.trips.find((trip) => trip.id === 'summer')
  assert.equal(spring.rateCentsPerMile, 72.5)
  assert.equal(summer.rateCentsPerMile, 76)
  assert.equal(spring.estimatedDeductionCents, Math.round(11 * 72.5))
  assert.equal(summer.estimatedDeductionCents, Math.round(2 * 76))
  assert.equal(packet.estimatedDeductionCents, spring.estimatedDeductionCents + summer.estimatedDeductionCents)
  assert.match(packet.rateLabel, /72\.5¢/)
  assert.match(packet.rateLabel, /76¢/)
  assert.match(packet.rateLabel, /Estimate/)
  assert.equal(packet.disclaimer, TAX_NOT_ADVICE)
  assert.equal(packet.stripe1099Url, STRIPE_CONNECT_1099_URL)
  assert.equal(rateForDate('2026-06-30T23:30:00-04:00', MILEAGE_RATE_CONFIG, TZ).centsPerMile, 72.5)
  assert.equal(rateForDate('2026-07-01T00:30:00-04:00', MILEAGE_RATE_CONFIG, TZ).centsPerMile, 76)
})

test('a stored accept-time en-route leg is kept when the trip row no longer has that point', () => {
  const packet = buildYearEndPacket({
    year: 2026,
    timeZone: TZ,
    grossEarningsCents: 0,
    tipsCents: 0,
    platformFeeCents: 0,
    driverNetCents: 0,
    trips: [{
      id: 't1',
      status: 'completed',
      completedAt: '2026-02-01T18:00:00Z',
      metadata: { route_distance_m: 1609.344 },
      pickupLabel: 'Campus',
      dropoffLabel: 'Airport',
    }],
    logs: [{
      trip_id: 't1',
      on_trip_miles: 1,
      on_trip_source: 'straight_line',
      enroute_miles: 0.4,
      enroute_source: 'straight_line',
    }],
  })
  assert.equal(packet.trips[0].onTripSource, 'routed')
  assert.equal(packet.trips[0].onTripMiles, 1)
  assert.equal(packet.trips[0].enrouteMiles, 0.4)
  assert.equal(packet.trips[0].enrouteSource, 'straight_line')
  assert.equal(packet.deductibleMiles, 1.4)
})

test('database rate rows replace the built-in config', () => {
  const rates = normalizeMileageRates([
    { tax_year: 2026, starts_on: '2026-01-01', ends_on: '2026-12-31', cents_per_mile: '80.00', label: 'Configured rate' },
  ])
  const packet = buildYearEndPacket({
    year: 2026,
    timeZone: TZ,
    rates,
    trips: [{
      id: 't',
      status: 'completed',
      completedAt: '2026-11-01T15:00:00Z',
      metadata: { route_distance_m: 1609.344 },
    }],
  })
  assert.equal(packet.trips[0].rateCentsPerMile, 80)
  assert.equal(packet.estimatedDeductionCents, 80)
  assert.match(packet.rateLabel, /Configured|80¢/)
})

test('csv and pdf include the estimate, the disclaimer, and the Stripe 1099 link', () => {
  const packet = buildYearEndPacket({
    year: 2026,
    timeZone: TZ,
    grossEarningsCents: 2500,
    tipsCents: null,
    platformFeeCents: 500,
    driverNetCents: 2000,
    trips: [{
      id: 't',
      status: 'completed',
      completedAt: '2026-05-01T15:00:00Z',
      pickupLabel: 'Campus',
      dropoffLabel: 'GSP',
      metadata: { route_distance_m: 1609.344 },
    }],
  })
  const csv = buildYearEndCsv(packet)
  assert.match(csv, /This is not tax advice/)
  assert.match(csv, /Estimated mileage deduction/)
  assert.match(csv, /En-route-to-pickup miles/)
  assert.match(csv, /not tracked/)
  assert.match(csv, new RegExp(STRIPE_CONNECT_1099_URL.replace(/[.]/g, '\\.')))
  assert.match(csv, new RegExp(FORM_1099_INFO_URL.replace(/[./]/g, '\\$&')))
  assert.match(csv, /Estimate,yes/)
  assert.match(csv, new RegExp(MILEAGE_ESTIMATE_NOTE.slice(0, 24)))
  assert.match(csv, new RegExp(STRIPE_1099_NOTE.slice(0, 20)))

  const pdf = Buffer.from(buildYearEndPdf(packet)).toString('latin1')
  assert.match(pdf, /^%PDF-1.4/)
  assert.match(pdf, /This is not tax advice/)
  assert.match(pdf, /connect\.stripe\.com\/express_login/)
  assert.match(pdf, /Estimated mileage deduction/)
  assert.match(pdf, /%%EOF/)
})
