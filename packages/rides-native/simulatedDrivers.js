/**
 * Demo cars for the rider map.
 * Drawn only as client-side markers. No driver accounts, no stored presence
 * rows, and no trips a matcher can assign.
 */
import { haversineMeters } from './riderShell.js'
import { DEMO_FLEET, DEMO_HIDE_NEAR_METERS, isDemoDriverId } from '../../shared/demoFleet.js'
import { fleetCarSvg } from '../../shared/fleetCarSvg.js'

export const SIMULATED_DRIVER_COUNT = DEMO_FLEET.length
export const SIMULATED_FLEET_TICK_MS = 250
export const SIMULATED_FLEET_BADGE = 'Preview cars'
export const BUSY_MARKER_FILL = '#522D80'
export { DEMO_HIDE_NEAR_METERS }

const ROUTE_DEFS = [
  {
    id: 'demo-marcus',
    area: 'Memorial Stadium',
    routeLabel: 'Loop around Memorial Stadium',
    cruiseMph: 22,
    phase: 0.04,
    route: [
      { lat: 34.6787, lng: -82.8466 },
      { lat: 34.6810, lng: -82.8452 },
      { lat: 34.6814, lng: -82.8430 },
      { lat: 34.6812, lng: -82.8406 },
      { lat: 34.6792, lng: -82.8396 },
      { lat: 34.6770, lng: -82.8404 },
      { lat: 34.6762, lng: -82.8432 },
      { lat: 34.6766, lng: -82.8460 },
      { lat: 34.6787, lng: -82.8466 },
    ],
  },
  {
    id: 'demo-jenna',
    area: 'College Avenue',
    routeLabel: 'College Avenue between campus and downtown',
    cruiseMph: 20,
    phase: 0.37,
    route: [
      { lat: 34.6810, lng: -82.8374 },
      { lat: 34.6822, lng: -82.8373 },
      { lat: 34.6834, lng: -82.8371 },
      { lat: 34.6846, lng: -82.8372 },
      { lat: 34.6858, lng: -82.8374 },
      { lat: 34.6846, lng: -82.8372 },
      { lat: 34.6834, lng: -82.8371 },
      { lat: 34.6822, lng: -82.8373 },
      { lat: 34.6810, lng: -82.8374 },
    ],
  },
  {
    id: 'demo-darnell',
    area: 'Clemson campus',
    routeLabel: 'Campus core past Tillman Hall and Sikes Hall',
    cruiseMph: 18,
    phase: 0.58,
    route: [
      { lat: 34.6805, lng: -82.8376 },
      { lat: 34.6796, lng: -82.8366 },
      { lat: 34.6784, lng: -82.8362 },
      { lat: 34.6776, lng: -82.8378 },
      { lat: 34.6782, lng: -82.8394 },
      { lat: 34.6794, lng: -82.8390 },
      { lat: 34.6805, lng: -82.8376 },
    ],
  },
  {
    id: 'demo-priya',
    area: 'Memorial Stadium and College Avenue',
    routeLabel: 'Memorial Stadium toward College Avenue',
    cruiseMph: 24,
    phase: 0.16,
    route: [
      { lat: 34.6788, lng: -82.8418 },
      { lat: 34.6794, lng: -82.8398 },
      { lat: 34.6802, lng: -82.8384 },
      { lat: 34.6812, lng: -82.8374 },
      { lat: 34.6826, lng: -82.8371 },
      { lat: 34.6838, lng: -82.8370 },
      { lat: 34.6826, lng: -82.8371 },
      { lat: 34.6812, lng: -82.8374 },
      { lat: 34.6802, lng: -82.8384 },
      { lat: 34.6794, lng: -82.8398 },
      { lat: 34.6788, lng: -82.8418 },
    ],
  },
  {
    id: 'demo-carlos',
    area: 'Downtown Clemson',
    routeLabel: 'Downtown loop on College Avenue',
    cruiseMph: 16,
    phase: 0.73,
    route: [
      { lat: 34.6848, lng: -82.8386 },
      { lat: 34.6852, lng: -82.8372 },
      { lat: 34.6850, lng: -82.8358 },
      { lat: 34.6836, lng: -82.8356 },
      { lat: 34.6832, lng: -82.8370 },
      { lat: 34.6834, lng: -82.8386 },
      { lat: 34.6848, lng: -82.8386 },
    ],
  },
  {
    id: 'demo-hannah',
    area: 'College Avenue',
    routeLabel: 'North College Avenue',
    cruiseMph: 19,
    phase: 0.21,
    route: [
      { lat: 34.6828, lng: -82.8362 },
      { lat: 34.6838, lng: -82.8354 },
      { lat: 34.6848, lng: -82.8360 },
      { lat: 34.6842, lng: -82.8376 },
      { lat: 34.6830, lng: -82.8372 },
      { lat: 34.6828, lng: -82.8362 },
    ],
  },
  {
    id: 'demo-terrence',
    area: 'Memorial Stadium',
    routeLabel: 'East of Memorial Stadium',
    cruiseMph: 21,
    phase: 0.44,
    route: [
      { lat: 34.6774, lng: -82.8410 },
      { lat: 34.6786, lng: -82.8394 },
      { lat: 34.6796, lng: -82.8408 },
      { lat: 34.6784, lng: -82.8424 },
      { lat: 34.6774, lng: -82.8410 },
    ],
  },
  {
    id: 'demo-mei',
    area: 'Clemson campus',
    routeLabel: 'Campus loop south of Tillman Hall',
    cruiseMph: 17,
    phase: 0.63,
    route: [
      { lat: 34.6778, lng: -82.8368 },
      { lat: 34.6788, lng: -82.8356 },
      { lat: 34.6798, lng: -82.8368 },
      { lat: 34.6788, lng: -82.8382 },
      { lat: 34.6778, lng: -82.8368 },
    ],
  },
  {
    id: 'demo-wade',
    area: 'Downtown Clemson',
    routeLabel: 'Downtown side streets',
    cruiseMph: 18,
    phase: 0.11,
    route: [
      { lat: 34.6840, lng: -82.8394 },
      { lat: 34.6850, lng: -82.8384 },
      { lat: 34.6854, lng: -82.8368 },
      { lat: 34.6842, lng: -82.8364 },
      { lat: 34.6840, lng: -82.8394 },
    ],
  },
  {
    id: 'demo-tasha',
    area: 'College Avenue',
    routeLabel: 'College Avenue southbound',
    cruiseMph: 22,
    phase: 0.52,
    route: [
      { lat: 34.6862, lng: -82.8376 },
      { lat: 34.6850, lng: -82.8375 },
      { lat: 34.6838, lng: -82.8373 },
      { lat: 34.6826, lng: -82.8374 },
      { lat: 34.6838, lng: -82.8373 },
      { lat: 34.6850, lng: -82.8375 },
      { lat: 34.6862, lng: -82.8376 },
    ],
  },
  {
    id: 'demo-luis',
    area: 'Memorial Stadium',
    routeLabel: 'Stadium service loop',
    cruiseMph: 16,
    phase: 0.81,
    route: [
      { lat: 34.6798, lng: -82.8448 },
      { lat: 34.6806, lng: -82.8432 },
      { lat: 34.6796, lng: -82.8416 },
      { lat: 34.6784, lng: -82.8430 },
      { lat: 34.6798, lng: -82.8448 },
    ],
  },
  {
    id: 'demo-brooke',
    area: 'Clemson campus',
    routeLabel: 'Campus edge toward downtown',
    cruiseMph: 20,
    phase: 0.29,
    route: [
      { lat: 34.6816, lng: -82.8398 },
      { lat: 34.6824, lng: -82.8384 },
      { lat: 34.6832, lng: -82.8376 },
      { lat: 34.6822, lng: -82.8364 },
      { lat: 34.6812, lng: -82.8378 },
      { lat: 34.6816, lng: -82.8398 },
    ],
  },
]

function routeMeters(route) {
  let total = 0
  for (let i = 0; i < route.length - 1; i += 1) {
    total += haversineMeters(route[i], route[i + 1]) || 0
  }
  return total
}

function periodMsFor(route, mph) {
  const meters = routeMeters(route)
  const metersPerSecond = mph * 0.44704
  if (!metersPerSecond) return 60_000
  return Math.max(1000, Math.round((meters / metersPerSecond) * 1000))
}

export const SIMULATED_DRIVERS = ROUTE_DEFS.map((row) => {
  const profile = DEMO_FLEET.find((car) => car.id === row.id)
  return {
    id: row.id,
    area: row.area,
    routeLabel: row.routeLabel,
    cruiseMph: row.cruiseMph,
    phase: row.phase,
    route: row.route,
    status: 'busy',
    bookable: false,
    online: false,
    isDemo: true,
    source: 'demo',
    firstName: profile?.firstName || 'Driver',
    label: profile?.label || row.routeLabel,
    body: profile?.body || 'suv',
    livery: profile?.livery || 'tiger',
    photo: profile?.photo || '',
    photoSmall: profile?.photoSmall || '',
    periodMs: periodMsFor(row.route, row.cruiseMph),
  }
})

function boundsFromDrivers(drivers) {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const driver of drivers) {
    for (const point of driver.route) {
      minLat = Math.min(minLat, point.lat)
      maxLat = Math.max(maxLat, point.lat)
      minLng = Math.min(minLng, point.lng)
      maxLng = Math.max(maxLng, point.lng)
    }
  }
  return {
    minLat: minLat - 0.0012,
    maxLat: maxLat + 0.0012,
    minLng: minLng - 0.0012,
    maxLng: maxLng + 0.0012,
  }
}

export const SIMULATED_FLEET_BOUNDS = boundsFromDrivers(SIMULATED_DRIVERS)

const geometryById = new Map()

function geometry(driver) {
  const cached = geometryById.get(driver.id)
  if (cached) return cached
  const segments = []
  let total = 0
  for (let i = 0; i < driver.route.length - 1; i += 1) {
    const a = driver.route[i]
    const b = driver.route[i + 1]
    const len = haversineMeters(a, b) || 0
    segments.push({ a, b, len })
    total += len
  }
  const next = { segments, total }
  geometryById.set(driver.id, next)
  return next
}

function bearingDeg(a, b) {
  const latScale = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const east = (b.lng - a.lng) * latScale
  const north = b.lat - a.lat
  if (east === 0 && north === 0) return 0
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
}

function progress01(driver, nowMs) {
  const turns = (nowMs / driver.periodMs) + driver.phase
  return ((turns % 1) + 1) % 1
}

function pointAt(driver, nowMs) {
  const { segments, total } = geometry(driver)
  const fallback = driver.route[0]
  if (!segments.length || total <= 0) {
    return { lat: fallback.lat, lng: fallback.lng, heading: 0 }
  }
  let remain = progress01(driver, nowMs) * total
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    const last = i === segments.length - 1
    if (remain <= seg.len || last) {
      const t = seg.len <= 0 ? 0 : Math.min(1, remain / seg.len)
      return {
        lat: seg.a.lat + (seg.b.lat - seg.a.lat) * t,
        lng: seg.a.lng + (seg.b.lng - seg.a.lng) * t,
        heading: bearingDeg(seg.a, seg.b),
      }
    }
    remain -= seg.len
  }
  return { lat: fallback.lat, lng: fallback.lng, heading: 0 }
}

export function simulatedDriverDescription(driver) {
  const who = driver.firstName && driver.label ? `${driver.firstName}, ${driver.label}. ` : ''
  return `${who}${driver.routeLabel}. Already driving a rider. Not available to request.`
}

export function isSimulatedDriverId(id) {
  const key = String(id || '').trim()
  if (!key) return false
  if (key.startsWith('sim-busy-')) return true
  if (isDemoDriverId(key)) return true
  return SIMULATED_DRIVERS.some((driver) => driver.id === key)
}

export function demoCarsNearReal(fleet, realDrivers, meters = DEMO_HIDE_NEAR_METERS) {
  const real = (realDrivers || []).filter((driver) => driver && !isSimulatedDriverId(driver.id))
  return (fleet || []).filter((car) => {
    if (!isSimulatedDriverId(car.id)) return true
    return !real.some((driver) => {
      if (driver.lat == null || driver.lng == null) return false
      return haversineMeters(car, driver) <= meters
    })
  })
}

export function simulatedAlongTrackMeters(driverId, nowMs) {
  const driver = SIMULATED_DRIVERS.find((row) => row.id === driverId)
  if (!driver) return 0
  const { total } = geometry(driver)
  return progress01(driver, nowMs) * total
}

export function simulatedFleetAt(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0
  return SIMULATED_DRIVERS.map((driver) => {
    const point = pointAt(driver, now)
    return {
      id: driver.id,
      area: driver.area,
      routeLabel: driver.routeLabel,
      status: 'busy',
      bookable: false,
      online: false,
      isDemo: true,
      source: 'demo',
      firstName: driver.firstName,
      label: driver.label,
      body: driver.body,
      livery: driver.livery,
      photo: driver.photo,
      photoSmall: driver.photoSmall,
      lat: point.lat,
      lng: point.lng,
      heading: point.heading,
      title: driver.firstName,
      description: simulatedDriverDescription(driver),
    }
  })
}

export function simulatedFleetPercent(lat, lng) {
  const { minLat, maxLat, minLng, maxLng } = SIMULATED_FLEET_BOUNDS
  const x = (Number(lng) - minLng) / (maxLng - minLng)
  const y = (maxLat - Number(lat)) / (maxLat - minLat)
  const clamp = (n) => Math.min(0.92, Math.max(0.08, n))
  return { left: clamp(x) * 100, top: clamp(y) * 100 }
}

/** Tap result for a demo car. No trip, charge, alert, or match. */
export function refuseSimulatedDriverTap(id) {
  const known = isSimulatedDriverId(id)
  return {
    booked: false,
    charged: false,
    notified: false,
    matched: false,
    status: known ? 'busy' : null,
  }
}

export function busyCarSvg(heading, car) {
  return fleetCarSvg({
    heading,
    body: car?.body || 'suv',
    livery: car?.livery || 'tiger',
  })
}
