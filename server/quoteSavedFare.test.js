import assert from 'node:assert/strict'
import test from 'node:test'
import handleQuote from './endpoints/quoteFare.js'
import handleBilling from './endpoints/rideBilling.js'
import { distanceFareCents } from '../src/lib/scheduledRideModel.js'
import { tripMeters } from '../src/lib/scheduledRideModel.js'
import {
  CARPOOL_SEAT_FRACTION_BPS,
  COMFORT_FARE_MULTIPLIER_BPS,
  scaleCents,
  WAIT_SAVE_MULTIPLIER_BPS,
} from '../src/lib/fareRates.js'
import {
  placesForServerFare,
  priceScheduledRequest,
  riderTierQuotes,
} from './authoritativeFare.js'

const QUIET = new Date('2026-09-23T15:00:00.000Z')
const GAME_DAY = new Date('2026-10-03T16:00:00.000Z')
const SIKES = { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 }
const COOPER = { label: 'Cooper Library', lat: 34.6765, lng: -82.8375 }
const DOWNTOWN = { label: 'Downtown Clemson', lat: 34.6836, lng: -82.8364 }
const TIGER = {
  id: 'tiger-1',
  email: 'tiger@g.clemson.edu',
  email_confirmed_at: '2026-01-01T00:00:00Z',
}

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    setHeader() {},
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(handler, body, deps) {
  const res = mockRes()
  await handler({ method: 'POST', headers: {}, body }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

function sb() {
  const rowsFor = (table) => {
    if (table === 'profiles') return [{ id: 'drv-1', email: 'driver@example.com' }]
    if (table === 'driver_applications') {
      return [{ profile_id: 'drv-1', onboarding_status: 'approved' }]
    }
    if (table === 'vehicles') {
      return [{ driver_id: 'drv-1', service_class: 'standard', tier: 'standard' }]
    }
    if (table === 'driver_status') {
      return [{ driver_id: 'drv-1', online: true }]
    }
    return []
  }
  return {
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        lte() { return chain },
        gte() { return chain },
        gt() { return chain },
        in() { return chain },
        order() { return chain },
        limit() { return chain },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: rowsFor(table), error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  }
}

function route(distanceM, durationS) {
  return async () => ({ distanceM, durationS })
}

test('campus tiers use the saved fare, not the catalog placeholder', () => {
  const quotes = riderTierQuotes({
    pickup: SIKES,
    dropoff: COOPER,
    at: QUIET,
    isStudent: false,
    distanceM: 400,
    durationS: 90,
  })
  const standard = quotes.tiers.find((row) => row.id === 'standard')
  const wait = quotes.tiers.find((row) => row.id === 'wait')
  const comfort = quotes.tiers.find((row) => row.id === 'comfort')
  assert.equal(standard.fareCents, quotes.fareCents)
  assert.equal(wait.fareCents, scaleCents(standard.fareCents, WAIT_SAVE_MULTIPLIER_BPS))
  assert.equal(comfort.fareCents, scaleCents(standard.fareCents, COMFORT_FARE_MULTIPLIER_BPS))
  assert.ok(wait.fareCents < standard.fareCents)
  assert.ok(standard.fareCents < comfort.fareCents)
  const carpool = quotes.tiers.find((row) => row.id === 'carpool')
  assert.equal(carpool.fareCents, scaleCents(standard.fareCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.ok(carpool.fareCents < standard.fareCents)
  const twoSeats = priceScheduledRequest({
    pickup: SIKES,
    dropoff: COOPER,
    at: QUIET,
    isStudent: false,
    tier: 'carpool',
    distanceM: 400,
    durationS: 90,
    seatCount: 2,
  })
  assert.equal(twoSeats.perSeatFareCents, carpool.fareCents)
  assert.equal(twoSeats.fareCents, carpool.fareCents * 2)
  assert.notEqual(standard.fareCents, 1850)
  assert.ok(standard.fareCents < 1000)
})

test('an airport quote is the airport fare on every ride type', () => {
  const located = placesForServerFare({
    pickupLabel: 'Sikes Hall',
    pickupLat: SIKES.lat,
    pickupLng: SIKES.lng,
    dest: 'GSP Airport',
    destLat: SIKES.lat,
    destLng: SIKES.lng,
    fareCents: 1850,
    isStudent: true,
  })
  assert.equal(located.airport, 'GSP')
  const quotes = riderTierQuotes({
    pickup: located.pickup,
    dropoff: located.dropoff,
    airport: located.airport,
    at: QUIET,
    isStudent: false,
  })
  const saved = priceScheduledRequest({
    pickup: located.pickup,
    dropoff: located.dropoff,
    airport: 'GSP',
    at: QUIET,
    isStudent: false,
  })
  assert.equal(quotes.fareCents, saved.fareCents)
  assert.ok(quotes.fareCents > 5000)
  assert.equal(quotes.depositCents, saved.depositCents)
  const standardFare = quotes.tiers.find((row) => row.id === 'standard').fareCents
  const waitFare = quotes.tiers.find((row) => row.id === 'wait').fareCents
  const comfortFare = quotes.tiers.find((row) => row.id === 'comfort').fareCents
  assert.equal(standardFare, saved.fareCents)
  assert.equal(waitFare, scaleCents(saved.fareCents, WAIT_SAVE_MULTIPLIER_BPS))
  assert.equal(comfortFare, scaleCents(saved.fareCents, COMFORT_FARE_MULTIPLIER_BPS))
  assert.ok(waitFare < standardFare && standardFare < comfortFare)
  for (const fare of [standardFare, waitFare, comfortFare]) {
    assert.notEqual(fare, 1850)
  }
  const carpoolFare = quotes.tiers.find((row) => row.id === 'carpool').fareCents
  assert.equal(carpoolFare, scaleCents(saved.fareCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.ok(carpoolFare < saved.fareCents)
})

test('a game-day schedule quote matches the surged fare that is saved', () => {
  const meters = tripMeters(DOWNTOWN, COOPER)
  const oldEstimate = distanceFareCents(meters, null)
  assert.equal(oldEstimate, 800)
  const saved = priceScheduledRequest({
    pickup: DOWNTOWN,
    dropoff: COOPER,
    at: GAME_DAY,
    isStudent: false,
    gameDayMultiplier: 1.8,
  })
  const quotes = riderTierQuotes({
    pickup: DOWNTOWN,
    dropoff: COOPER,
    at: GAME_DAY,
    isStudent: false,
    gameDayMultiplier: 1.8,
  })
  assert.equal(saved.surge.multiplier, 1.25) // live event, stadium-area trip, capped at 1.25x
  assert.equal(quotes.fareCents, saved.fareCents)
  assert.notEqual(quotes.fareCents, oldEstimate)
  const plain = priceScheduledRequest({ pickup: DOWNTOWN, dropoff: COOPER, at: GAME_DAY, isStudent: false, gameDayMultiplier: null })
  assert.ok(quotes.fareCents > plain.fareCents, 'game-day quote is above the plain fare')
})

test('quote and confirm ignore client fare, miles, and isStudent', async () => {
  const body = {
    pickupLabel: 'Sikes Hall',
    pickupLat: SIKES.lat,
    pickupLng: SIKES.lng,
    dest: 'Cooper Library',
    destLat: COOPER.lat,
    destLng: COOPER.lng,
    fareCents: 1850,
    depositCents: 450,
    amount: 1850,
    total: 1850,
    miles: 0.1,
    minutes: 1,
    isStudent: true,
    tier: 'standard',
  }
  const deps = {
    sb: sb(),
    user: null,
    now: QUIET,
    computeRoutes: route(820, 180),
  }
  const quote = await call(handleQuote, body, deps)
  const billing = await call(handleBilling, { ...body, mode: 'quote' }, { ...deps, user: { id: 'rider-1' } })
  const expected = priceScheduledRequest({
    pickup: SIKES,
    dropoff: COOPER,
    at: QUIET,
    isStudent: false,
    distanceM: 820,
    durationS: 180,
  })
  assert.equal(quote.status, 200)
  assert.equal(billing.status, 200)
  assert.equal(quote.json.fareCents, expected.fareCents)
  assert.equal(billing.json.fareCents, expected.fareCents)
  assert.equal(quote.json.studentDiscountApplied, false)
  assert.notEqual(quote.json.fareCents, 1850)
  assert.equal(
    quote.json.tiers.find((row) => row.id === 'comfort').fareCents,
    scaleCents(expected.fareCents, COMFORT_FARE_MULTIPLIER_BPS),
  )
  assert.ok(quote.json.tripMinutes > 0)
  assert.equal(quote.json.tiers.find((row) => row.id === 'standard').etaMinutes, 4)
})

test('a confirmed Clemson email discounts the quoted fare the same way the trip is saved', async () => {
  const body = {
    pickup: SIKES,
    dropoff: COOPER,
    fareCents: 100,
    isStudent: false,
  }
  const quote = await call(handleQuote, body, {
    sb: sb(),
    user: TIGER,
    now: QUIET,
    computeRoutes: route(900, 200),
  })
  const expected = priceScheduledRequest({
    pickup: SIKES,
    dropoff: COOPER,
    at: QUIET,
    isStudent: true,
    distanceM: 900,
    durationS: 200,
  })
  assert.equal(quote.status, 200)
  assert.equal(quote.json.studentDiscountApplied, true)
  assert.equal(quote.json.fareCents, expected.fareCents)
  assert.equal(quote.json.discountCents, expected.discountCents)
  assert.ok(quote.json.discountCents > 0)
})
