/**
 * Ride-tier carpool matching.
 * Riders group when pickup and drop-off are each inside the radius and
 * departure times share a window. A group books at 3 riders and caps at 4.
 * Demo cars never count. Each rider is pre-authorized for their own seat.
 * Each seat is a card hold captured at trip end.
 */
import { haversineMeters } from '../src/lib/rideGeometry.js'
import { isDemoDriverId } from './demoFleet.js'
import { fareAuthorizationCents } from './fareAuthorization.js'

export const CARPOOL_MATCH_RADIUS_MILES = 0.5
export const CARPOOL_MATCH_WINDOW_MS = 20 * 60 * 1000
export const CARPOOL_GROUP_MIN = 3
export const CARPOOL_GROUP_MAX = 4
/** Driver app scheme. A tap on the remote push opens this trip. */
export const DRIVER_TRIP_SCHEME = 'clemsonrides-driver'
const METERS_PER_MILE = 1609.344

export function carpoolMatchRadiusMiles() {
  const raw = Number(process.env.CARPOOL_MATCH_RADIUS_MILES)
  if (Number.isFinite(raw) && raw > 0 && raw <= 5) return raw
  return CARPOOL_MATCH_RADIUS_MILES
}

export function isDemoCarId(id) {
  const key = String(id || '').trim()
  if (!key) return false
  if (key.startsWith('sim-busy-')) return true
  if (key.startsWith('demo-')) return true
  return isDemoDriverId(key)
}

export function carpoolTripDeepLink(tripId) {
  const id = String(tripId || '').trim()
  if (!id) return null
  return `${DRIVER_TRIP_SCHEME}://trip?id=${encodeURIComponent(id)}`
}

export function carpoolReadyNotice(count) {
  const n = Math.max(0, Math.round(Number(count) || 0))
  let word = String(n)
  switch (n) {
    case 3:
      word = 'Three'
      break
    case 4:
      word = 'Four'
      break
    default:
      word = String(n)
      break
  }
  return {
    title: 'Carpool ready',
    body: `${word} people found, going from same or similar location to same or similar drop-off.`,
    riderCount: n,
  }
}

function point(value) {
  if (!value || typeof value !== 'object') return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function withinRadius(a, b, radiusMeters) {
  const left = point(a)
  const right = point(b)
  if (!left || !right) return false
  const meters = haversineMeters(left.lat, left.lng, right.lat, right.lng)
  return meters != null && meters <= radiusMeters
}

function withinWindow(a, b, windowMs) {
  const left = new Date(a).getTime()
  const right = new Date(b).getTime()
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  return Math.abs(left - right) <= windowMs
}

function departStamp(row) {
  return row?.departAt || row?.depart_at
}

export function riderRequestsMatch(a, b, { radiusMiles, windowMs } = {}) {
  const miles = Number(radiusMiles) > 0 ? Number(radiusMiles) : carpoolMatchRadiusMiles()
  const window = Number(windowMs) > 0 ? Number(windowMs) : CARPOOL_MATCH_WINDOW_MS
  const radiusMeters = miles * METERS_PER_MILE
  return withinRadius(a?.pickup, b?.pickup, radiusMeters)
    && withinRadius(a?.dropoff, b?.dropoff, radiusMeters)
    && withinWindow(departStamp(a), departStamp(b), window)
}

function demoRequest(row) {
  if (row?.demo === true || row?.demoCar === true) return true
  return isDemoCarId(row?.driverId || row?.driver_id || row?.vehicleId || row?.vehicle_id)
}

function riderKey(row) {
  return String(row?.riderId || row?.rider_id || '').trim()
}

export function groupCarpoolRequests(requests, options = {}) {
  const radiusMiles = options.radiusMiles ?? carpoolMatchRadiusMiles()
  const windowMs = options.windowMs ?? CARPOOL_MATCH_WINDOW_MS
  const maxSize = options.maxSize ?? CARPOOL_GROUP_MAX
  const sorted = [...(requests || [])].filter(Boolean).sort((a, b) => {
    return new Date(departStamp(a)).getTime() - new Date(departStamp(b)).getTime()
  })
  const latest = new Map()
  for (const row of sorted) {
    if (demoRequest(row)) continue
    const key = riderKey(row)
    if (!key || !point(row.pickup) || !point(row.dropoff)) continue
    latest.set(key, row)
  }
  const eligible = [...latest.values()].sort((a, b) => {
    return new Date(departStamp(a)).getTime() - new Date(departStamp(b)).getTime()
  })
  const used = new Set()
  const groups = []
  for (let i = 0; i < eligible.length; i += 1) {
    const seed = eligible[i]
    const seedKey = riderKey(seed)
    if (used.has(seedKey)) continue
    const members = [seed]
    used.add(seedKey)
    for (let j = i + 1; j < eligible.length && members.length < maxSize; j += 1) {
      const other = eligible[j]
      const otherKey = riderKey(other)
      if (used.has(otherKey)) continue
      if (!riderRequestsMatch(seed, other, { radiusMiles, windowMs })) continue
      members.push(other)
      used.add(otherKey)
    }
    groups.push(members)
  }
  return groups
}

export function carpoolDriverId(drivers) {
  for (const driver of drivers || []) {
    const id = String(driver?.id || driver || '').trim()
    if (id && !isDemoCarId(id)) return id
  }
  return null
}

function seatHold(riderId, perSeat) {
  const auth = fareAuthorizationCents(perSeat)
  return {
    riderId,
    estimatedFareCents: perSeat,
    depositCents: 0,
    holdKind: 'preauth',
    ...auth,
  }
}

/**
 * Book the first group that reaches the fill threshold.
 * The result is one trip, one pre-auth hold per rider, and the driver notice.
 */
export function planCarpoolFill(requests, {
  perSeatFareCents,
  drivers = [],
  radiusMiles,
  windowMs,
  minSize = CARPOOL_GROUP_MIN,
  maxSize = CARPOOL_GROUP_MAX,
  tripId = null,
} = {}) {
  const groups = groupCarpoolRequests(requests, { radiusMiles, windowMs, maxSize })
  const filled = groups.find((group) => group.length >= minSize) || null
  if (!filled) {
    return {
      booked: false,
      groups,
      riders: [],
      waiting: groups.flat(),
      holds: [],
      notice: null,
      inApp: null,
      push: null,
      driverId: null,
      trip: null,
    }
  }
  const riders = filled.slice(0, maxSize)
  const waiting = groups.filter((group) => group !== filled).flat()
  const perSeat = Math.max(0, Math.round(Number(perSeatFareCents) || 0))
  const holds = riders.map((rider) => seatHold(riderKey(rider), perSeat))
  const notice = carpoolReadyNotice(riders.length)
  const driverId = carpoolDriverId(drivers)
  const anchorId = tripId
    || riders.map((row) => row.tripId || row.trip_id).find(Boolean)
    || null
  const trip = {
    id: anchorId,
    tier: 'carpool',
    status: 'searching',
    rider_id: riderKey(riders[0]),
    passengers: riders.length,
    fare_cents: perSeat * riders.length,
    deposit_cents: 0,
    driver_id: null,
    metadata: {
      kind: 'carpool_seat',
      ride_option: 'carpool',
      carpool_rider_ids: riders.map((row) => riderKey(row)),
      merged_trip_ids: riders.map((row) => row.tripId || row.trip_id).filter(Boolean),
      seat_holds: holds,
      driver_notice: { title: notice.title, body: notice.body, riderCount: notice.riderCount },
    },
  }
  const push = {
    title: notice.title,
    body: notice.body,
    data: {
      kind: 'carpool_ready',
      riderCount: notice.riderCount,
      tripId: anchorId,
      tier: 'carpool',
      url: carpoolTripDeepLink(anchorId),
    },
  }
  return {
    booked: true,
    groups,
    riders,
    waiting,
    holds,
    notice,
    inApp: { title: notice.title, body: notice.body },
    push,
    driverId,
    trip,
  }
}
