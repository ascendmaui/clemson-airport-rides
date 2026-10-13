/**
 * Offer-card route: driver → pickup in Clemson orange, pickup → drop-off in purple.
 * Earnings figures use only numbers already on the card or estimated from those coordinates.
 */
import { estimateLeg } from '../../src/lib/rideGeometry.js'
import { formatDriverNetPay } from './offerCard.js'
import { formatHourlyRate, offerHourly, offerLegs } from './offerLadder.js'

export const OFFER_TO_PICKUP = '#F56600'
export const OFFER_TO_DROPOFF = '#522D80'

function coord(latitude, longitude) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { latitude: lat, longitude: lng }
}

export function offerRoutePoints({ driver, pickup, dropoff }) {
  return {
    driver: driver ? coord(driver.latitude, driver.longitude) : null,
    pickup: pickup ? coord(pickup.latitude, pickup.longitude) : null,
    dropoff: dropoff ? coord(dropoff.latitude, dropoff.longitude) : null,
  }
}

export function offerRouteLegs(input) {
  const { driver, pickup, dropoff } = offerRoutePoints(input)
  const legs = []
  if (driver && pickup) {
    legs.push({ id: 'to-pickup', color: OFFER_TO_PICKUP, coordinates: [driver, pickup] })
  }
  if (pickup && dropoff) {
    legs.push({ id: 'to-dropoff', color: OFFER_TO_DROPOFF, coordinates: [pickup, dropoff] })
  }
  return legs
}

/** Region that contains every point, expanded so the strokes are not on the edge. */
export function offerRouteRegion(points, padding = 0.28) {
  const spots = (points || []).filter(Boolean)
  if (!spots.length) return null
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const spot of spots) {
    minLat = Math.min(minLat, spot.latitude)
    maxLat = Math.max(maxLat, spot.latitude)
    minLng = Math.min(minLng, spot.longitude)
    maxLng = Math.max(maxLng, spot.longitude)
  }
  const latSpan = Math.max(0.012, maxLat - minLat)
  const lngSpan = Math.max(0.012, maxLng - minLng)
  const pad = Math.max(0, Number(padding) || 0)
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latSpan * (1 + pad * 2),
    longitudeDelta: lngSpan * (1 + pad * 2),
  }
}

function money(cents) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`
}

function tripMiles(card) {
  const listed = Number(card?.distanceMi ?? card?.distance_mi ?? card?.distance)
  if (listed > 0) return listed
  if (card?.pickupLat == null || card?.dropoffLat == null) return null
  const leg = estimateLeg(
    [Number(card.pickupLat), Number(card.pickupLng)],
    [Number(card.dropoffLat), Number(card.dropoffLng)],
  )
  if (!leg?.meters) return null
  return leg.meters / 1609.344
}

/** Fare payout plus $/mi and $/min when the card has the distance or time. */
export function offerPayoutFigures(card, driver) {
  const pay = formatDriverNetPay(card)
  const figures = [{ id: 'payout', label: 'Fare payout', value: pay.formattedNet }]
  const miles = tripMiles(card)
  if (miles > 0 && pay.netCents > 0) {
    figures.push({ id: 'per-mile', label: 'Per mile', value: `${money(pay.netCents / miles)}/mi` })
  }
  const legs = offerLegs(card, driver)
  const minutes = (Number(legs.tripSeconds) || 0) / 60
  if (minutes > 0 && pay.netCents > 0) {
    figures.push({ id: 'per-min', label: 'Per minute', value: `${money(pay.netCents / minutes)}/min` })
  }
  const hourly = offerHourly(card, driver)
  if (hourly && hourly.hourlyCents > 0) {
    figures.push({ id: 'hourly', label: 'Hourly', value: formatHourlyRate(hourly.hourlyCents) })
  }
  return figures
}
