/**
 * Remaining road line and ETA from a polyline already stored on the trip.
 * No Directions request. Callers may overlay a throttled leg when this snap misses.
 */
import { CAMPUS_MPH, formatDriverDistance } from './drivers.js'
import { activeTripRouteLine, decodeRoutePolyline, etaLineFor } from './liveTrip.js'
import { haversineMeters } from './riderShell.js'

/** Overview polylines can sit off the lane. Farther than this, keep the straight line. */
export const ROAD_SNAP_METERS = 500

function asPoint(value) {
  if (!value) return null
  const lat = Number(value.lat ?? value.latitude)
  const lng = Number(value.lng ?? value.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function storedEncoded(trip) {
  const encoded = trip?.metadata?.route_polyline || trip?.route_polyline || trip?.routePolyline || null
  return typeof encoded === 'string' && encoded ? encoded : null
}

function storedDurationS(trip) {
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const raw = meta.route_duration_s ?? trip?.route_duration_s ?? trip?.routeDurationS ?? null
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds
}

export function pathLengthMeters(points) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const meters = haversineMeters(points[i - 1], points[i])
    if (meters != null) total += meters
  }
  return total
}

function closestOnSegment(a, b, p) {
  const latScale = 111320
  const lngScale = 111320 * Math.cos((a.lat * Math.PI) / 180)
  const bx = (b.lng - a.lng) * lngScale
  const by = (b.lat - a.lat) * latScale
  const px = (p.lng - a.lng) * lngScale
  const py = (p.lat - a.lat) * latScale
  const len2 = bx * bx + by * by
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2
  t = Math.max(0, Math.min(1, t))
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
  return { point, meters: haversineMeters(point, p) ?? Infinity }
}

/** Path from the closest point on the polyline through the end, when the fix is close enough. */
export function snapPathSuffix(points, from, maxMeters = ROAD_SNAP_METERS) {
  const origin = asPoint(from)
  if (!origin || !Array.isArray(points) || points.length < 2) return null
  let best = null
  for (let i = 0; i < points.length - 1; i += 1) {
    const hit = closestOnSegment(points[i], points[i + 1], origin)
    if (!best || hit.meters < best.meters) best = { ...hit, index: i }
  }
  if (!best || best.meters > maxMeters) return null
  const path = [best.point, ...points.slice(best.index + 1)]
  return {
    path,
    distanceM: pathLengthMeters(path),
    totalM: pathLengthMeters(points),
    snapMeters: best.meters,
  }
}

/**
 * In-progress only. The stored polyline is pickup to drop-off, so it is the
 * road the car is on after the trip starts, not the drive to pickup.
 */
export function storedRoadSuffix(trip, driver, status = trip?.status) {
  if (status !== 'in_progress' || !trip) return null
  const decoded = decodeRoutePolyline(storedEncoded(trip))
  if (decoded.length < 2) return null
  return snapPathSuffix(decoded, driver)
}

export function legNounForStatus(status) {
  switch (status) {
    case 'accepted':
    case 'arriving':
      return 'pickup'
    case 'in_progress':
      return 'drop-off'
    default:
      return null
  }
}

export function directionsEtaLine({ meters, seconds, noun } = {}) {
  if (!noun) return null
  const sec = Number(seconds)
  if (!Number.isFinite(sec) || sec <= 0) return null
  const minutes = Math.max(1, Math.round(sec / 60))
  const rawMeters = Number(meters)
  const miles = Number.isFinite(rawMeters) && rawMeters >= 0 ? rawMeters / 1609.344 : null
  const distance = miles == null ? null : formatDriverDistance(Math.round(miles * 10) / 10)
  return distance
    ? `About ${minutes} min · ${distance} by road to ${noun}`
    : `About ${minutes} min by road to ${noun}`
}

export function remainingRoadLine(distanceM, totalM, durationS, noun) {
  const meters = Number(distanceM)
  if (!noun || !Number.isFinite(meters) || meters <= 0) return null
  const duration = Number(durationS)
  const total = Number(totalM)
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(total) && total > 0) {
    return directionsEtaLine({ meters, seconds: duration * Math.min(1, meters / total), noun })
  }
  const miles = meters / 1609.344
  const etaMin = Math.max(1, Math.round((miles / CAMPUS_MPH) * 60))
  const distance = formatDriverDistance(Math.round(miles * 10) / 10)
  return distance
    ? `About ${etaMin} min · ${distance} by road to ${noun}`
    : `About ${etaMin} min by road to ${noun}`
}

/** Road ETA while in progress. Every other phase keeps the straight-line line. */
export function followEtaLine(status, from, places) {
  if (status === 'in_progress') {
    const snapped = storedRoadSuffix(places, from, status)
    if (snapped) {
      const line = remainingRoadLine(snapped.distanceM, snapped.totalM, storedDurationS(places), 'drop-off')
      if (line) return line
    }
  }
  return etaLineFor(status, from, places)
}

/** [lat, lng] pairs. Snapped remainder wins in progress; otherwise the existing route line. */
export function followRouteLine(trip, driver) {
  const snapped = storedRoadSuffix(trip, driver)
  if (snapped && snapped.path.length > 1) {
    return snapped.path.map((spot) => [spot.lat, spot.lng])
  }
  return activeTripRouteLine(trip, driver)
}

export function followMapCoordinates(trip, driver) {
  return followRouteLine(trip, driver).map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
}

/** Degrees clockwise from north. Null when the two points are the same. */
export function travelBearing(from, to) {
  const start = asPoint(from)
  const end = asPoint(to)
  if (!start || !end) return null
  const y = Math.sin(((end.lng - start.lng) * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180)
  const x = Math.cos((start.lat * Math.PI) / 180) * Math.sin((end.lat * Math.PI) / 180)
    - Math.sin((start.lat * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180) * Math.cos(((end.lng - start.lng) * Math.PI) / 180)
  if (Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8) return null
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Shortest-angle blend so a heading does not spin the long way around north. */
export function lerpHeading(from, to, t) {
  const end = Number(to)
  const start = Number(from)
  const amount = Number.isFinite(Number(t)) ? Math.min(1, Math.max(0, Number(t))) : 1
  if (!Number.isFinite(end)) return Number.isFinite(start) ? start : null
  if (!Number.isFinite(start)) return end
  const delta = ((end - start + 540) % 360) - 180
  return (start + delta * amount + 360) % 360
}
