import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_OFFER_TTL_SECONDS,
  airportBadge,
  depositBadge,
  driverNetPayText,
  dropoffShortLabel,
  formatDistance,
  formatDistanceEta,
  formatDriverNetPay,
  formatEta,
  formatOfferCard,
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
} from './offerCard.js'
import { syntheticOffers } from './syntheticOffers.js'

test('pickup and dropoff short labels: airports, addresses, bullets, and fallbacks', () => {
  // Airport shortening
  assert.equal(shortPlaceLabel('Greenville-Spartanburg International Airport (GSP)'), 'GSP Airport')
  assert.equal(shortPlaceLabel('GSP Airport arrivals'), 'GSP Airport')
  assert.equal(shortPlaceLabel('Charlotte Douglas International Airport (CLT)'), 'CLT Airport')
  assert.equal(shortPlaceLabel('CLT Airport Terminal 1'), 'CLT Airport')
  assert.equal(shortPlaceLabel('Hartsfield-Jackson Atlanta International Airport (ATL)'), 'ATL Airport')

  // Commas / street addresses
  assert.equal(shortPlaceLabel('120 College Ave, Clemson, SC 29631'), '120 College Ave')
  assert.equal(shortPlaceLabel('105 Sikes Hall, Clemson, SC 29634'), '105 Sikes Hall')
  assert.equal(shortPlaceLabel('410 Cedar Ln, Clemson, SC'), '410 Cedar Ln')

  // Bullets and middle dots
  assert.equal(shortPlaceLabel('Downtown Clemson · College Ave'), 'Downtown Clemson')
  assert.equal(shortPlaceLabel('Memorial Stadium • Gate 1'), 'Memorial Stadium')

  // Parenthetical removal
  assert.equal(shortPlaceLabel('Memorial Stadium (Gate 1)'), 'Memorial Stadium')

  // Clean landmarks
  assert.equal(shortPlaceLabel('Tillman Hall'), 'Tillman Hall')
  assert.equal(shortPlaceLabel('The Pier'), 'The Pier')

  // Missing fields and fallbacks
  assert.equal(shortPlaceLabel(null), '')
  assert.equal(shortPlaceLabel(undefined), '')
  assert.equal(shortPlaceLabel(''), '')
  assert.equal(shortPlaceLabel('   ', 'Default'), 'Default')
  assert.equal(shortPlaceLabel(null, 'Fallback Place'), 'Fallback Place')
})

test('pickupShortLabel and dropoffShortLabel with card objects and missing fields', () => {
  const card = {
    pickupLabel: 'Downtown Clemson · College Ave',
    dropoffLabel: 'Greenville-Spartanburg International Airport (GSP)',
  }
  assert.equal(pickupShortLabel(card), 'Downtown Clemson')
  assert.equal(dropoffShortLabel(card), 'GSP Airport')
  assert.equal(routeHeadline(card), 'Downtown Clemson → GSP Airport')

  // Snake_case support
  const snakeCard = {
    pickup_label: '120 College Ave, Clemson, SC 29631',
    dropoff_label: 'The Pier',
  }
  assert.equal(pickupShortLabel(snakeCard), '120 College Ave')
  assert.equal(dropoffShortLabel(snakeCard), 'The Pier')
  assert.equal(routeHeadline(snakeCard), '120 College Ave → The Pier')

  // Direct string arguments
  assert.equal(pickupShortLabel('Tillman Hall'), 'Tillman Hall')
  assert.equal(dropoffShortLabel('Charlotte Douglas International Airport (CLT)'), 'CLT Airport')
  assert.equal(routeHeadline('Tillman Hall', 'CLT'), 'Tillman Hall → CLT Airport')

  // Missing fields
  assert.equal(pickupShortLabel(null), 'Pickup')
  assert.equal(pickupShortLabel({}), 'Pickup')
  assert.equal(pickupShortLabel({ pickupLabel: '' }), 'Pickup')
  assert.equal(pickupShortLabel(null, 'Origin'), 'Origin')

  assert.equal(dropoffShortLabel(null), 'Drop-off')
  assert.equal(dropoffShortLabel({}), 'Drop-off')
  assert.equal(dropoffShortLabel({ dropoffLabel: '' }), 'Drop-off')
  assert.equal(dropoffShortLabel(null, 'Destination'), 'Destination')

  assert.equal(routeHeadline(null), 'Pickup → Drop-off')
  assert.equal(routeHeadline({}, {}), 'Pickup → Drop-off')
})

test('driver net pay reuses existing earnings helpers without inventing numbers', () => {
  // Standard fare: $68.00 fare -> $54.40 driver net (80%), $13.60 platform fee (20%)
  const standardCard = {
    status: 'offered',
    fareCents: 6800,
  }
  const pay = formatDriverNetPay(standardCard)
  assert.equal(pay.netCents, 5440)
  assert.equal(pay.formattedNet, '$54.40')
  assert.equal(pay.platformFeeCents, 1360)
  assert.equal(pay.formattedPlatformFee, '$13.60')
  assert.equal(pay.isCarpool, false)
  assert.equal(pay.baseNetCents, null)
  assert.equal(pay.carpoolBonusCents, null)
  assert.match(pay.subtext, /you net 80%/i)
  assert.equal(driverNetPayText(standardCard), '$54.40')

  // Carpool incentive
  const carpoolCard = {
    status: 'offered',
    fareCents: 8000,
    driverPayoutCents: 7500,
    baseNetCents: 6400,
    carpoolBonusCents: 1100,
    carpoolIncentiveId: 'driver_carpool_bonus',
    metadata: {
      kind: 'carpool',
      driver_payout_cents: 7500,
      incentive_id: 'driver_carpool_bonus',
      carpool: {
        driver: {
          payoutCents: 7500,
          soloPayoutCents: 6400,
          carpoolBonusCents: 1100,
          incentiveId: 'driver_carpool_bonus',
        },
      },
    },
  }
  const carpoolPay = formatDriverNetPay(carpoolCard)
  assert.equal(carpoolPay.netCents, 7500)
  assert.equal(carpoolPay.formattedNet, '$75.00')
  assert.equal(carpoolPay.isCarpool, true)
  assert.equal(carpoolPay.baseNetCents, 6400)
  assert.equal(carpoolPay.formattedBaseNet, '$64.00')
  assert.equal(carpoolPay.carpoolBonusCents, 1100)
  assert.equal(carpoolPay.formattedCarpoolBonus, '$11.00')
  assert.equal(carpoolPay.carpoolIncentiveId, 'driver_carpool_bonus')
  assert.match(carpoolPay.subtext, /base \$64\.00/i)
  assert.match(carpoolPay.subtext, /driver_carpool_bonus \$11\.00/i)
  assert.match(carpoolPay.subtext, /total \$75\.00/i)

  // Card with explicit net but 0 fareCents
  const explicitCard = {
    driverNetCents: 3200,
  }
  const explicitPay = formatDriverNetPay(explicitCard)
  assert.equal(explicitPay.netCents, 3200)
  assert.equal(explicitPay.formattedNet, '$32.00')

  // Missing fields / empty card / null
  const emptyPay = formatDriverNetPay(null)
  assert.equal(emptyPay.netCents, 0)
  assert.equal(emptyPay.formattedNet, '$0.00')
  assert.equal(emptyPay.platformFeeCents, 0)
  assert.equal(emptyPay.formattedPlatformFee, '$0.00')
  assert.equal(emptyPay.isCarpool, false)
  assert.equal(emptyPay.subtext, 'You net 80%')
  assert.equal(driverNetPayText(null), '$0.00')
})

test('distance and ETA formatting with card, primitives, and missing fields', () => {
  // Both present
  assert.equal(formatDistanceEta({ etaMin: 4, distanceMi: 32 }), '4 min away · 32 mi')
  assert.equal(formatDistanceEta(4, 32), '4 min away · 32 mi')

  // Decimal miles and 1-minute / 1-mile singular
  assert.equal(formatDistanceEta({ etaMin: 1, distanceMi: 1 }), '1 min away · 1 mi')
  assert.equal(formatDistanceEta({ etaMin: 6, distanceMi: 2.4 }), '6 min away · 2.4 mi')
  assert.equal(formatDistanceEta(0, 5), '< 1 min away · 5 mi')

  // Snake case fields
  assert.equal(formatDistanceEta({ eta_min: 8, distance_mi: 15.5 }), '8 min away · 15.5 mi')

  // Only ETA
  assert.equal(formatDistanceEta({ etaMin: 5 }), '5 min away')
  assert.equal(formatEta(5), '5 min away')
  assert.equal(formatEta(1), '1 min away')
  assert.equal(formatEta(0), '< 1 min away')
  assert.equal(formatEta(-2), null)

  // Only distance
  assert.equal(formatDistanceEta({ distanceMi: 12 }), '12 mi')
  assert.equal(formatDistance(12), '12 mi')
  assert.equal(formatDistance(1), '1 mi')
  assert.equal(formatDistance(3.1415), '3.1 mi')
  assert.equal(formatDistance(-1), null)

  // Missing fields
  assert.equal(formatDistanceEta(null), null)
  assert.equal(formatDistanceEta({}), null)
  assert.equal(formatDistanceEta({ etaMin: null, distanceMi: undefined }), null)
  assert.equal(formatDistanceEta('', ''), null)
  assert.equal(formatEta(null), null)
  assert.equal(formatEta(''), null)
  assert.equal(formatDistance(null), null)
  assert.equal(formatDistance(''), null)
})

test('seats formatting: passenger counts, view-model, and missing fields', () => {
  // Passenger counts
  assert.equal(formatSeats({ passengers: 1 }), '1 seat')
  assert.equal(formatSeats({ passengers: 2 }), '2 seats')
  assert.equal(formatSeats({ passengers: 4 }), '4 seats')

  // Direct number
  assert.equal(formatSeats(1), '1 seat')
  assert.equal(formatSeats(3), '3 seats')

  // Alternative field names (seats, partySize)
  assert.equal(formatSeats({ seats: 3 }), '3 seats')
  assert.equal(formatSeats({ partySize: 2 }), '2 seats')
  assert.equal(formatSeats({ party_size: 5 }), '5 seats')

  // seatsViewModel structured output
  assert.deepEqual(seatsViewModel({ passengers: 3 }), {
    count: 3,
    seatsLabel: '3 seats',
    ridersLabel: '3 riders',
  })
  assert.deepEqual(seatsViewModel(1), {
    count: 1,
    seatsLabel: '1 seat',
    ridersLabel: '1 rider',
  })

  // Missing fields and invalid values
  assert.equal(formatSeats(null), null)
  assert.equal(formatSeats({}), null)
  assert.equal(formatSeats({ passengers: 0 }), null)
  assert.equal(formatSeats(-1), null)
  assert.equal(formatSeats('invalid'), null)

  assert.deepEqual(seatsViewModel(null), {
    count: null,
    seatsLabel: null,
    ridersLabel: null,
  })
  assert.deepEqual(seatsViewModel({ passengers: 0 }), {
    count: null,
    seatsLabel: null,
    ridersLabel: null,
  })
})

test('airport and deposit badges: airport trip detection, deposit formatting, and missing fields', () => {
  // Airport trip
  const gspCard = {
    dropoffLabel: 'GSP Airport',
    rideType: 'Airport',
    fareCents: 6800,
    depositCents: 1700,
    tags: ['student'],
    tagLabels: ['Student'],
  }
  assert.equal(isAirportTrip(gspCard), true)

  const gspBadge = airportBadge(gspCard)
  assert.deepEqual(gspBadge, {
    id: 'airport',
    label: 'GSP Airport',
    code: 'GSP',
    tone: 'purple',
  })

  const depBadge = depositBadge(gspCard)
  assert.deepEqual(depBadge, {
    id: 'deposit',
    label: '25% deposit · $17.00',
    shortLabel: '25% deposit',
    amountCents: 1700,
    formattedAmount: '$17.00',
    tone: 'orange',
  })

  // Badges collection
  const badges = offerBadges(gspCard)
  assert.equal(badges.length, 3)
  assert.equal(badges[0].id, 'airport')
  assert.equal(badges[1].id, 'deposit')
  assert.equal(badges[2].id, 'student')

  // Charlotte Airport code
  const cltCard = {
    pickupLabel: 'Tillman Hall',
    dropoffLabel: 'Charlotte Douglas International Airport (CLT)',
  }
  assert.equal(isAirportTrip(cltCard), true)
  assert.equal(airportBadge(cltCard)?.code, 'CLT')

  // Atlanta Airport code
  const atlCard = {
    pickupLabel: 'Memorial Stadium',
    dropoffLabel: 'Hartsfield-Jackson Atlanta (ATL)',
  }
  assert.equal(isAirportTrip(atlCard), true)
  assert.equal(airportBadge(atlCard)?.code, 'ATL')

  // Non-airport, non-deposit card
  const campusCard = {
    pickupLabel: 'Downtown Clemson',
    dropoffLabel: 'The Pier',
    depositCents: 0,
    tags: ['weekend_party'],
    tagLabels: ['Weekend'],
  }
  assert.equal(isAirportTrip(campusCard), false)
  assert.equal(airportBadge(campusCard), null)
  assert.equal(depositBadge(campusCard), null)
  assert.deepEqual(offerBadges(campusCard), [
    { id: 'weekend', label: 'Weekend', tone: 'orange' },
  ])

  // Missing fields
  assert.equal(isAirportTrip(null), false)
  assert.equal(airportBadge(null), null)
  assert.equal(depositBadge(null), null)
  assert.deepEqual(offerBadges(null), [])
  assert.deepEqual(offerBadges({}), [])
})

test('time left to accept label: seconds, minutes, expiry, and missing fields', () => {
  // Direct seconds
  assert.equal(timeLeftToAcceptSeconds(15), 15)
  assert.equal(timeLeftToAcceptLabel(15), '15s to accept')
  assert.equal(isOfferExpired(15), false)

  assert.equal(timeLeftToAcceptLabel(1), '1s to accept')
  assert.equal(timeLeftToAcceptLabel(75), '1m 15s to accept')
  assert.equal(timeLeftToAcceptLabel(120), '2m to accept')

  // Expired
  assert.equal(timeLeftToAcceptSeconds(0), 0)
  assert.equal(timeLeftToAcceptLabel(0), 'Offer expired')
  assert.equal(isOfferExpired(0), true)

  assert.equal(timeLeftToAcceptSeconds(-5), -5)
  assert.equal(timeLeftToAcceptLabel(-5), 'Offer expired')
  assert.equal(isOfferExpired(-5), true)

  // Card with secondsLeft
  assert.equal(timeLeftToAcceptLabel({ secondsLeft: 20 }), '20s to accept')
  assert.equal(timeLeftToAcceptLabel({ seconds_left: 8 }), '8s to accept')

  // Card with expiresAt
  const now = new Date('2026-09-25T12:00:00.000Z')
  const futureExpiry = new Date('2026-09-25T12:00:18.000Z').toISOString()
  const pastExpiry = new Date('2026-09-25T11:59:50.000Z').toISOString()

  assert.equal(timeLeftToAcceptSeconds({ expiresAt: futureExpiry }, { now }), 18)
  assert.equal(timeLeftToAcceptLabel({ expiresAt: futureExpiry }, { now }), '18s to accept')
  assert.equal(isOfferExpired({ expiresAt: futureExpiry }, { now }), false)

  assert.equal(timeLeftToAcceptLabel({ expiresAt: pastExpiry }, { now }), 'Offer expired')
  assert.equal(isOfferExpired({ expiresAt: pastExpiry }, { now }), true)

  // Card with offeredAt + TTL
  const offeredAt = new Date('2026-09-25T12:00:00.000Z').toISOString()
  const nowAt10s = new Date('2026-09-25T12:00:10.000Z')
  assert.equal(timeLeftToAcceptSeconds({ offeredAt }, { now: nowAt10s, ttlSeconds: 30 }), 20)
  assert.equal(timeLeftToAcceptLabel({ offeredAt }, { now: nowAt10s, ttlSeconds: 30 }), '20s to accept')

  // Missing fields
  assert.equal(timeLeftToAcceptSeconds(null), null)
  assert.equal(timeLeftToAcceptSeconds({}), null)
  assert.equal(timeLeftToAcceptLabel(null), null)
  assert.equal(timeLeftToAcceptLabel({}), null)
  assert.equal(isOfferExpired(null), false)
  assert.equal(isOfferExpired({}), false)
})

test('offerCardViewModel formats synthetic offers end-to-end', () => {
  const [ava, mason, jordan] = syntheticOffers(new Date('2026-09-25T12:00:00.000Z'))

  // Ava: Tillman Hall -> GSP Airport
  const avaVm = offerCardViewModel(ava, { now: '2026-09-25T12:00:00.000Z' })
  assert.equal(avaVm.id, 'synthetic-tillman-gsp')
  assert.equal(avaVm.status, 'offered')
  assert.equal(avaVm.rider.firstName, 'Ava')
  assert.equal(avaVm.rider.rating, 4.9)
  assert.equal(avaVm.rider.ratingText, '4.9')
  assert.equal(avaVm.pickup.shortLabel, 'Tillman Hall')
  assert.equal(avaVm.dropoff.shortLabel, 'GSP Airport')
  assert.equal(avaVm.routeHeadline, 'Tillman Hall → GSP Airport')
  assert.equal(avaVm.pay.formattedNet, '$54.40')
  assert.equal(avaVm.distanceEta, '4 min away · 32 mi')
  assert.equal(avaVm.eta, '4 min away')
  assert.equal(avaVm.distance, '32 mi')
  assert.equal(avaVm.seats.seatsLabel, '1 seat')
  assert.equal(avaVm.isAirport, true)
  assert.equal(avaVm.airport?.code, 'GSP')
  assert.equal(avaVm.deposit?.formattedAmount, '$17.00')

  // Mason: Downtown Clemson -> The Pier
  const masonVm = offerCardViewModel(mason)
  assert.equal(masonVm.rider.firstName, 'Mason')
  assert.equal(masonVm.pickup.shortLabel, 'Downtown Clemson')
  assert.equal(masonVm.dropoff.shortLabel, 'The Pier')
  assert.equal(masonVm.routeHeadline, 'Downtown Clemson → The Pier')
  assert.equal(masonVm.pay.formattedNet, '$11.20')
  assert.equal(masonVm.distanceEta, '6 min away · 2.4 mi')
  assert.equal(masonVm.seats.seatsLabel, '2 seats')
  assert.equal(masonVm.isAirport, false)
  assert.equal(masonVm.airport, null)

  // Jordan: Memorial Stadium -> GSP Airport
  const jordanVm = formatOfferCard(jordan)
  assert.equal(jordanVm.rider.firstName, 'Jordan')
  assert.equal(jordanVm.pickup.shortLabel, 'Memorial Stadium')
  assert.equal(jordanVm.dropoff.shortLabel, 'GSP Airport')
  assert.equal(jordanVm.pay.formattedNet, '$59.20')
  assert.equal(jordanVm.distanceEta, '8 min away · 33 mi')
  assert.equal(jordanVm.seats.seatsLabel, '3 seats')
  assert.equal(jordanVm.isAirport, true)
  assert.equal(jordanVm.deposit?.formattedAmount, '$18.50')
})

test('offerCardViewModel safely handles empty, null, or sparse card', () => {
  const vmNull = offerCardViewModel(null)
  assert.equal(vmNull.id, null)
  assert.equal(vmNull.status, 'offered')
  assert.equal(vmNull.rider.firstName, 'Rider')
  assert.equal(vmNull.rider.rating, null)
  assert.equal(vmNull.pickup.shortLabel, 'Pickup')
  assert.equal(vmNull.dropoff.shortLabel, 'Drop-off')
  assert.equal(vmNull.routeHeadline, 'Pickup → Drop-off')
  assert.equal(vmNull.pay.formattedNet, '$0.00')
  assert.equal(vmNull.distanceEta, null)
  assert.equal(vmNull.seats.seatsLabel, null)
  assert.deepEqual(vmNull.badges, [])
  assert.equal(vmNull.airport, null)
  assert.equal(vmNull.deposit, null)
  assert.equal(vmNull.timeLeft, null)
  assert.equal(vmNull.timeLeftLabel, null)

  const vmEmpty = offerCardViewModel({})
  assert.equal(vmEmpty.pay.formattedNet, '$0.00')
  assert.equal(vmEmpty.pickup.shortLabel, 'Pickup')
  assert.equal(vmEmpty.dropoff.shortLabel, 'Drop-off')
  assert.equal(vmEmpty.distanceEta, null)
  assert.equal(vmEmpty.isAirport, false)
})

test('offerAccessibilityLabel provides a combined concise summary for screen readers', () => {
  const [ava, mason] = syntheticOffers(new Date('2026-09-25T12:00:00.000Z'))

  // Ava: Tillman Hall -> GSP Airport
  const avaVm = offerCardViewModel(ava, { now: '2026-09-25T12:00:00.000Z' })
  assert.ok(avaVm.accessibilityLabel)
  assert.equal(
    avaVm.accessibilityLabel,
    'Ride offer: $54.40 net pay. From Tillman Hall to GSP Airport. Rider Ava, 4.9 rating. 4 min away · 32 mi. 1 seat. 25% deposit · $17.00. Fri, Sep 25, 8:12 AM',
  )
  assert.equal(offerAccessibilityLabel(ava, { now: '2026-09-25T12:00:00.000Z' }), avaVm.accessibilityLabel)

  // Mason: Downtown Clemson -> The Pier
  const masonVm = offerCardViewModel(mason, { now: '2026-09-25T12:00:00.000Z' })
  assert.ok(masonVm.accessibilityLabel)
  assert.equal(
    masonVm.accessibilityLabel,
    'Ride offer: $11.20 net pay. From Downtown Clemson to The Pier. Rider Mason, 4.8 rating. 6 min away · 2.4 mi. 2 seats. 25% deposit · $3.50. Fri, Sep 25, 8:45 AM',
  )

  // Direct card object with countdown passed to offerAccessibilityLabel
  const liveOffer = {
    pickupLabel: 'Sikes Hall',
    dropoffLabel: 'GSP Airport',
    driverNetCents: 4500,
    firstName: 'Chloe',
    riderRating: 5.0,
    secondsLeft: 18,
  }
  assert.equal(
    offerAccessibilityLabel(liveOffer),
    'Ride offer: $45.00 net pay. From Sikes Hall to GSP Airport. Rider Chloe, 5.0 rating. 18s to accept',
  )

  // Empty and null cards
  assert.equal(offerAccessibilityLabel(null), 'Ride offer: $0.00 net pay. From Pickup to Drop-off')
  assert.equal(offerAccessibilityLabel({}), 'Ride offer: $0.00 net pay. From Pickup to Drop-off')
})

