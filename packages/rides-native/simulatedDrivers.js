/**
 * Demo cars for the rider map during a rush.
 * Drawn only as client-side markers. No driver accounts, no stored presence
 * rows, and no trips a matcher can assign.
 */
import { haversineMeters } from './riderShell.js'

export const SIMULATED_DRIVER_COUNT = 5
export const SIMULATED_FLEET_TICK_MS = 250
export const SIMULATED_DRIVER_TITLE = 'Busy'
export const SIMULATED_FLEET_BADGE = 'Busy · already on a ride'
export const BUSY_MARKER_FILL = '#522D80'

const ROUTE_DEFS = [
  {
    id: 'sim-busy-stadium-loop',
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
    id: 'sim-busy-college-ave',
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
    id: 'sim-busy-campus-core',
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
    id: 'sim-busy-stadium-college',
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
    id: 'sim-busy-downtown-block',
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

export const SIMULATED_DRIVERS = ROUTE_DEFS.map((row) => ({
  id: row.id,
  area: row.area,
  routeLabel: row.routeLabel,
  cruiseMph: row.cruiseMph,
  phase: row.phase,
  route: row.route,
  status: 'busy',
  bookable: false,
  online: false,
  periodMs: periodMsFor(row.route, row.cruiseMph),
}))

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
  return `${driver.routeLabel}. Already driving a rider. Not available to request.`
}

export function isSimulatedDriverId(id) {
  const key = String(id || '').trim()
  if (!key) return false
  if (key.startsWith('sim-busy-')) return true
  return SIMULATED_DRIVERS.some((driver) => driver.id === key)
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
      lat: point.lat,
      lng: point.lng,
      heading: point.heading,
      title: SIMULATED_DRIVER_TITLE,
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

export function busyCarSvg(heading) {
  const deg = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0
  const snapped = Math.round(deg / 15) * 15
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
    <g transform="rotate(${snapped} 24 18)">
      <rect x="17" y="6" width="14" height="24" rx="5" fill="${BUSY_MARKER_FILL}" stroke="#ffffff" stroke-width="2"/>
      <rect x="20" y="9" width="8" height="6" rx="1.5" fill="#F7F4F0"/>
    </g>
    <rect x="8" y="38" width="32" height="14" rx="7" fill="${BUSY_MARKER_FILL}" stroke="#ffffff" stroke-width="1.5"/>
    <text x="24" y="48" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="10" font-weight="700">Busy</text>
  </svg>`
}
