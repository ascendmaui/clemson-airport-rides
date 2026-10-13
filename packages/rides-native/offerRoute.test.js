import assert from 'node:assert/strict'
import test from 'node:test'
import { offerPayoutFigures, offerRouteLegs, offerRouteRegion, OFFER_TO_DROPOFF, OFFER_TO_PICKUP } from './offerRoute.js'

const pickup = { latitude: 34.678, longitude: -82.84 }
const dropoff = { latitude: 34.896, longitude: -82.219 }
const driver = { latitude: 34.69, longitude: -82.85 }

test('offer route draws pickup in orange and drop-off in purple, fit with padding', () => {
  const legs = offerRouteLegs({ driver, pickup, dropoff })
  assert.deepEqual(legs.map((leg) => leg.color), [OFFER_TO_PICKUP, OFFER_TO_DROPOFF])
  assert.equal(OFFER_TO_PICKUP, '#F56600')
  assert.equal(OFFER_TO_DROPOFF, '#522D80')
  assert.deepEqual(legs[0].coordinates, [driver, pickup])
  assert.deepEqual(legs[1].coordinates, [pickup, dropoff])
  const region = offerRouteRegion(legs.flatMap((leg) => leg.coordinates))
  assert.ok(region.latitudeDelta > 34.896 - 34.678)
  assert.ok(region.longitudeDelta > 0.012)
  assert.equal(offerRouteLegs({ pickup, dropoff }).some((leg) => leg.id === 'to-pickup'), false)
})

test('offer payout figures include fare payout and a per-mile or per-minute rate when the data exists', () => {
  const card = {
    fareCents: 4000,
    status: 'searching',
    pickupLat: pickup.latitude,
    pickupLng: pickup.longitude,
    dropoffLat: dropoff.latitude,
    dropoffLng: dropoff.longitude,
    distanceMi: 32,
    routeDurationS: 2400,
  }
  const figures = offerPayoutFigures(card, { lat: driver.latitude, lng: driver.longitude })
  const payout = figures.find((item) => item.id === 'payout')
  const perMile = figures.find((item) => item.id === 'per-mile')
  const perMin = figures.find((item) => item.id === 'per-min')
  assert.match(payout.value, /^\$\d+\.\d{2}$/)
  assert.match(perMile.value, /^\$\d+\.\d{2}\/mi$/)
  assert.match(perMin.value, /^\$\d+\.\d{2}\/min$/)
  const bare = offerPayoutFigures({ fareCents: 0 }, null)
  assert.equal(bare.length, 1)
  assert.equal(bare[0].id, 'payout')
})
