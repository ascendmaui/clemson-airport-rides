/**
 * Parallel C. Offer-card branches the existing offerCard.test.js does not pin.
 * Explicit nets and $0 empty cards only. No fare-formula edits.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  airportBadge,
  dropoffShortLabel,
  formatDistance,
  formatDistanceEta,
  formatEta,
  formatSeats,
  isAirportTrip,
  isOfferExpired,
  offerAccessibilityLabel,
  offerBadges,
  offerCardViewModel,
  pickupShortLabel,
  routeHeadline,
  seatsViewModel,
  shortPlaceLabel,
  timeLeftToAcceptLabel,
  timeLeftToAcceptSeconds,
  DEFAULT_OFFER_TTL_SECONDS,
} from '../packages/rides-native/offerCard.js'

const NOW = new Date('2026-09-25T12:00:00.000Z')

test('place labels prefer an airport code over commas, bullets, and parens', () => {
  assert.equal(shortPlaceLabel('GSP, Clemson, SC'), 'GSP Airport')
  assert.equal(shortPlaceLabel('  greenville-spartanburg arrivals  '), 'GSP Airport')
  assert.equal(shortPlaceLabel('Meet at ATL, then campus'), 'ATL Airport')
  assert.equal(shortPlaceLabel('Hartsfield parking, Atlanta'), 'Hartsfield parking')
  assert.equal(shortPlaceLabel('Hartsfield-Jackson parking'), 'ATL Airport')
  assert.equal(shortPlaceLabel(0), '0')
  assert.equal(shortPlaceLabel('Hall · Gate, Clemson'), 'Hall')
  assert.equal(shortPlaceLabel(' • Only bullet'), '• Only bullet')
  assert.equal(shortPlaceLabel('Tillman Hall (Gate 1) (extra)'), 'Tillman Hall (Gate 1)')
  assert.equal(pickupShortLabel({ pickup_label: '' }), 'Pickup')
  assert.equal(dropoffShortLabel({ dropoff_label: '   ' }), 'Drop-off')
})

test('a two-argument headline uses the string drop-off and ignores the card drop-off', () => {
  const card = { pickupLabel: 'Tillman Hall', dropoffLabel: 'The Pier' }
  assert.equal(routeHeadline(card, 'CLT'), 'Tillman Hall → CLT Airport')
  assert.equal(routeHeadline(card), 'Tillman Hall → The Pier')
  assert.equal(routeHeadline('   ', ''), 'Pickup → Drop-off')
})

test('distance and ETA reject non-finite values and round fractional miles once', () => {
  assert.equal(formatEta('4'), '4 min away')
  assert.equal(formatEta('4.6'), '5 min away')
  assert.equal(formatEta(Number.NaN), null)
  assert.equal(formatEta(Number.POSITIVE_INFINITY), null)
  assert.equal(formatEta('soon'), null)
  assert.equal(formatDistance(0), '0 mi')
  assert.equal(formatDistance(1.0), '1 mi')
  assert.equal(formatDistance(1.04), '1 mi')
  assert.equal(formatDistance(1.05), '1.1 mi')
  assert.equal(formatDistance(Number.NaN), null)
  assert.equal(formatDistance(Number.POSITIVE_INFINITY), null)
  assert.equal(formatDistanceEta({ eta: '2', distance: '1.04' }), '2 min away · 1 mi')
  assert.equal(formatDistanceEta({ etaMin: Number.NaN, distanceMi: 3 }), '3 mi')
  assert.equal(formatDistanceEta(Number.NaN, Number.NaN), null)
})

test('seat count prefers passengers, then seats, then party size, and rounds', () => {
  assert.equal(formatSeats({ passengers: 1, seats: 4, party_size: 9 }), '1 seat')
  assert.equal(formatSeats({ seats: 4, partySize: 2 }), '4 seats')
  assert.equal(formatSeats({ party_size: 1.6 }), '2 seats')
  assert.equal(formatSeats(1.4), '1 seat')
  assert.equal(formatSeats(0.4), null)
  assert.equal(formatSeats('2'), '2 seats')
  assert.equal(formatSeats({ passengers: '0' }), null)
  assert.deepEqual(seatsViewModel({ passengers: 2.4, seats: 9 }), {
    count: 2,
    seatsLabel: '2 seats',
    ridersLabel: '2 riders',
  })
  assert.deepEqual(seatsViewModel({ passengers: Number.NaN }), {
    count: null,
    seatsLabel: null,
    ridersLabel: null,
  })
  assert.deepEqual(seatsViewModel(''), {
    count: null,
    seatsLabel: null,
    ridersLabel: null,
  })
})

test('airport detection uses purpose, tags, and labels without treating Atlas as ATL', () => {
  assert.equal(isAirportTrip({ purpose: 'airport' }), true)
  assert.equal(isAirportTrip({ purpose: 'Airport' }), true)
  assert.equal(isAirportTrip({ rideType: 'campus' }), false)
  assert.equal(isAirportTrip({ tags: ['airport'], pickupLabel: 'Tillman Hall', dropoffLabel: 'The Pier' }), true)
  assert.equal(isAirportTrip({ tagLabels: ['Airport'] }), true)
  // `atl` is not a word boundary here, so Atlas and Atlantic count as airport trips.
  assert.equal(isAirportTrip({ dropoffLabel: 'Atlas Gym' }), true)
  assert.equal(isAirportTrip({ dropoffLabel: 'Atlantic Ave' }), true)
  assert.equal(airportBadge({ dropoffLabel: 'Atlas Gym' })?.code, null)
  assert.equal(airportBadge({ dropoffLabel: 'Atlantic Ave' })?.label, 'Airport')
  assert.equal(isAirportTrip({ pickupLabel: 'Meet at ATL' }), true)
  assert.equal(airportBadge({ pickupLabel: 'Meet at ATL' })?.code, 'ATL')

  const bare = airportBadge({ tags: ['airport'], pickupLabel: 'Tillman Hall', dropoffLabel: 'The Pier' })
  assert.deepEqual(bare, { id: 'airport', label: 'Airport', code: null, tone: 'purple' })

  const badges = offerBadges({
    tags: ['airport', 'direct'],
    pickupLabel: 'Tillman Hall',
    dropoffLabel: 'The Pier',
  })
  assert.deepEqual(badges.map((badge) => badge.id), ['airport', 'preferred_by_rider'])
  assert.equal(badges[1].label, 'Preferred by rider')
  assert.equal(badges[1].tone, 'orange')

  const spaced = offerBadges({
    tags: ['airport'],
    tagLabels: ['Late night'],
    pickupLabel: 'Tillman Hall',
    dropoffLabel: 'The Pier',
  })
  assert.deepEqual(spaced.map((badge) => badge.id), ['airport', 'late_night'])
  assert.equal(spaced[1].tone, 'purple')
})

test('countdown rounds, ignores bad clocks, and uses requested_at with the default TTL', () => {
  assert.equal(DEFAULT_OFFER_TTL_SECONDS, 30)
  assert.equal(timeLeftToAcceptSeconds(15.6), 16)
  assert.equal(timeLeftToAcceptLabel(60), '1m to accept')
  assert.equal(timeLeftToAcceptLabel(61), '1m 1s to accept')
  assert.equal(timeLeftToAcceptLabel(59.6), '1m to accept')
  assert.equal(timeLeftToAcceptSeconds({ secondsLeft: 'nope' }), null)
  assert.equal(timeLeftToAcceptLabel({ secondsLeft: 'nope' }), null)
  assert.equal(isOfferExpired({ secondsLeft: 'nope' }), false)
  assert.equal(timeLeftToAcceptSeconds({ seconds_left: 8.4 }), 8)

  assert.equal(timeLeftToAcceptSeconds({ expiresAt: 'not-a-date' }, { now: NOW }), null)
  assert.equal(timeLeftToAcceptSeconds({ expires_at: '2026-09-25T12:00:45.000Z' }, { now: NOW }), 45)
  assert.equal(timeLeftToAcceptLabel({ expires_at: '2026-09-25T12:00:45.000Z' }, { now: NOW }), '45s to accept')

  const requested = timeLeftToAcceptSeconds(
    { requested_at: '2026-09-25T12:00:00.000Z' },
    { now: new Date('2026-09-25T12:00:10.000Z') },
  )
  assert.equal(requested, 20)
  assert.equal(
    timeLeftToAcceptSeconds(
      { offered_at: '2026-09-25T12:00:00.000Z' },
      { now: new Date('2026-09-25T12:00:40.000Z') },
    ),
    -10,
  )
  assert.equal(isOfferExpired({ offeredAt: 'not-a-date' }, { now: NOW }), false)
})

test('the view-model keeps status, rating text, and a New York pickup time', () => {
  const vm = offerCardViewModel({
    id: 'offer-1',
    status: 'scheduled',
    riderRating: 5,
    pickupLabel: 'Tillman Hall',
    dropoffLabel: 'The Pier',
    pickupAt: '2026-09-25T12:00:00.000Z',
    secondsLeft: 9,
  })
  assert.equal(vm.id, 'offer-1')
  assert.equal(vm.status, 'scheduled')
  assert.equal(vm.rider.firstName, 'Rider')
  assert.equal(vm.rider.rating, 5)
  assert.equal(vm.rider.ratingText, '5.0')
  assert.equal(vm.rider.rideType, null)
  assert.equal(vm.pickupAtText, 'Fri, Sep 25, 8:00 AM')
  assert.equal(vm.timeLeft.isUrgent, true)
  assert.equal(vm.timeLeft.label, '9s to accept')
  assert.equal(vm.timeLeft.seconds, 9)

  const named = offerCardViewModel({
    firstName: '',
    rider_first_name: 'Riley',
    rideType: 'campus',
    pickup_label: 'Sikes Hall',
    dropoff_label: 'The Pier',
  })
  assert.equal(named.rider.firstName, 'Riley')
  assert.equal(named.rider.rideType, 'campus')
  assert.equal(named.pickupAtText, null)
  assert.equal(named.timeLeft, null)
})

test('accessibility uses a prepared view-model and omits the default rider name', () => {
  assert.equal(
    offerAccessibilityLabel({
      pay: { formattedNet: '$9.00' },
      pickup: { shortLabel: 'Tillman Hall' },
      dropoff: { shortLabel: 'The Pier' },
      rider: { firstName: 'Sam', ratingText: '4.7' },
      distanceEta: '2 min away',
      seats: { seatsLabel: '1 seat' },
      airport: { label: 'Airport' },
      deposit: { label: '25% deposit · $1.00' },
      pickupAtText: 'Fri, Sep 25, 8:00 AM',
      timeLeft: { label: '9s to accept' },
    }),
    'Ride offer: $9.00 net pay. From Tillman Hall to The Pier. Rider Sam, 4.7 rating. 2 min away. 1 seat. Airport. 25% deposit · $1.00. Fri, Sep 25, 8:00 AM. 9s to accept',
  )

  assert.equal(
    offerAccessibilityLabel({
      pay: { formattedNet: '$9.00' },
      pickup: { shortLabel: 'GSP Airport' },
      dropoff: { label: 'The Pier' },
      rider: { firstName: 'Rider', rating: 4.2 },
      airport: { label: 'GSP Airport' },
    }),
    'Ride offer: $9.00 net pay. From GSP Airport to The Pier. Rider rating 4.2',
  )

  assert.equal(
    offerAccessibilityLabel({
      riderRating: 4.2,
      pickupLabel: 'Tillman Hall',
      dropoffLabel: 'The Pier',
    }),
    'Ride offer: $0.00 net pay. From Tillman Hall to The Pier. Rider rating 4.2',
  )

  const campusAirport = offerAccessibilityLabel({
    tags: ['airport'],
    pickupLabel: 'Tillman Hall',
    dropoffLabel: 'The Pier',
    firstName: 'Ava',
  })
  assert.match(campusAirport, /Rider Ava\. Airport$/)
  assert.match(campusAirport, /Airport/)
  assert.doesNotMatch(campusAirport, /rating/)
})
