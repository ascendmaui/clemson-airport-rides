/**
 * Rider and driver live-trip phases.
 * ETA is straight-line campus pace from coordinates already on the trip or driver_status.
 * TODO: a road-following ETA needs a billed GOOGLE_MAPS_API_KEY (Routes). Do not invent a telemetry API.
 */
import { driverApproach, formatDriverDistance, OPEN_POOL_COPY, PREFERRED_CANCELED_COPY, PREFERRED_MATCH_COPY } from './drivers.js'

export const DRIVER_TRACK_STEPS = [
  { id: 'accepted', label: 'Accepted' },
  { id: 'arriving', label: 'En route' },
  { id: 'arrived', label: 'Arrived' },
  { id: 'in_progress', label: 'In trip' },
  { id: 'completed', label: 'Done' },
]

/** Statuses a rider can open from home into the live track screen. */
export const RIDER_TRACK_STATUSES = [
  'searching',
  'offered',
  'requested',
  'accepted',
  'arriving',
  'arrived',
  'in_progress',
]

export const STILL_SEARCHING_MS = 45000

export const STILL_SEARCHING_COPY =
  'Still looking. No driver has accepted yet. Map motion is a preview, not a driver you can pick.'

export const SEARCH_PREVIEW_COPY =
  'Orange and purple motion is a preview. Only a real driver accept moves this ride.'

export const STRAIGHT_LINE_WAIT =
  'Straight-line ETA shows when the driver shares a location. Road time needs a billed Maps key.'

/** Preview cars belong on the open-pool search, not after a driver is assigned. */
export function showSearchTheater(status) {
  return status === 'searching' || status === 'offered'
}

/** Keep a status line when coordinates are missing so the card is not blank. */
export function etaHoldLine(status, etaLine) {
  if (etaLine) return etaLine
  switch (status) {
    case 'accepted':
    case 'arriving':
    case 'arrived':
    case 'in_progress':
      return STRAIGHT_LINE_WAIT
    default:
      return null
  }
}

/** Where Stripe should return. A dated hold stays on Schedule. An immediate ride opens track. */
export function checkoutSuccessHash({ tripId, scheduled = false } = {}) {
  if (!tripId) return '#/schedule?paid=1'
  const id = encodeURIComponent(tripId)
  if (scheduled) return `#/schedule?paid=1&trip=${id}`
  return `#/requested?trip=${id}&paid=1`
}

function matchStepLabel(status) {
  return status === 'requested' ? 'Requested' : 'Offered'
}

export function riderLiveSteps(status) {
  return [
    { id: 'searching', label: 'Searching' },
    { id: 'offered', label: matchStepLabel(status) },
    { id: 'enroute', label: 'En route' },
    { id: 'arrived', label: 'Arrived' },
    { id: 'in_trip', label: 'In trip' },
    { id: 'completed', label: 'Done' },
  ]
}

export function riderLiveStepIndex(status) {
  switch (status) {
    case 'searching':
      return 0
    case 'offered':
    case 'requested':
      return 1
    case 'accepted':
    case 'arriving':
      return 2
    case 'arrived':
      return 3
    case 'in_progress':
      return 4
    case 'completed':
      return 5
    default:
      return -1
  }
}

export function riderLiveCopy(status, { preferred = false } = {}) {
  switch (status) {
    case 'searching':
      return {
        kicker: 'SEARCHING',
        title: 'Looking for a driver',
        body: OPEN_POOL_COPY,
      }
    case 'offered':
      return {
        kicker: 'OFFERED',
        title: 'A driver is reviewing this ride',
        body: 'The request is in front of a driver. It stays in the open pool until someone accepts.',
      }
    case 'requested':
      return {
        kicker: 'REQUESTED',
        title: preferred ? 'Waiting on your driver' : 'Request sent',
        body: preferred
          ? PREFERRED_MATCH_COPY
          : 'Your driver has this request. You will see them on the way once they accept.',
      }
    case 'accepted':
      return {
        kicker: 'EN ROUTE',
        title: 'Your driver is on the way',
        body: 'They accepted and are heading to pickup.',
      }
    case 'arriving':
      return {
        kicker: 'EN ROUTE',
        title: 'Your driver is arriving',
        body: 'They are close to pickup. Distance updates from the location they already share.',
      }
    case 'arrived':
      return {
        kicker: 'ARRIVED',
        title: 'Your driver is at pickup',
        body: 'Head out and meet them. The trip starts once you are in the car.',
      }
    case 'in_progress':
      return {
        kicker: 'IN TRIP',
        title: 'You are on the way',
        body: 'The ride is underway toward your drop-off.',
      }
    case 'completed':
      return {
        kicker: 'COMPLETED',
        title: 'Trip complete',
        body: 'You are at the destination. Rate your driver when you are ready.',
      }
    case 'canceled':
    case 'cancelled_wait':
      return {
        kicker: 'CANCELED',
        title: 'This ride was canceled',
        body: preferred ? PREFERRED_CANCELED_COPY : 'This trip is closed.',
      }
    case 'scheduled':
      return {
        kicker: 'SCHEDULED',
        title: 'Pickup is on the calendar',
        body: 'This ride stays scheduled until it is time to match a driver.',
      }
    default:
      return {
        kicker: 'RIDE',
        title: 'Ride requested',
        body: 'Status updates as soon as a driver moves this trip.',
      }
  }
}

export function riderLiveView(status, options) {
  const preferred = Boolean(options?.preferred)
  const waitingMs = Number(options?.waitingMs) || 0
  const known = status || (preferred ? 'requested' : '')
  const copy = riderLiveCopy(known, { preferred })
  const stillSearching = (known === 'searching' || known === 'offered') && waitingMs >= STILL_SEARCHING_MS
  return {
    ...copy,
    body: stillSearching ? STILL_SEARCHING_COPY : copy.body,
    steps: riderLiveSteps(known),
    stepIndex: riderLiveStepIndex(known),
  }
}

function point(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { lat: latitude, lng: longitude }
}

export function etaTargetForStatus(status, places) {
  const pickup = point(places?.pickupLat ?? places?.pickup_lat, places?.pickupLng ?? places?.pickup_lng)
  const dropoff = point(places?.dropoffLat ?? places?.dropoff_lat, places?.dropoffLng ?? places?.dropoff_lng)
  switch (status) {
    case 'accepted':
    case 'arriving':
    case 'arrived':
      return { point: pickup, noun: 'pickup' }
    case 'in_progress':
      return { point: dropoff, noun: 'drop-off' }
    default:
      return { point: null, noun: null }
  }
}

export function straightLineEta(from, to) {
  const empty = { etaMin: null, distanceMi: null, label: null }
  const approach = driverApproach(
    from ? { lat: from.lat, lng: from.lng } : null,
    to ? { lat: to.lat, lng: to.lng } : null,
  )
  if (approach.etaMin == null) return empty
  const distance = formatDriverDistance(approach.distanceMi)
  const label = distance
    ? `About ${approach.etaMin} min · ${distance} straight line`
    : `About ${approach.etaMin} min straight line`
  return { etaMin: approach.etaMin, distanceMi: approach.distanceMi, label }
}

export function etaLineFor(status, from, places) {
  const target = etaTargetForStatus(status, places)
  if (!target.point || !target.noun) return null
  const eta = straightLineEta(from, target.point)
  return eta.label ? `${eta.label} to ${target.noun}` : null
}
