/**
 * Demo cars for the rider map during a rush.
 * Drawn only as client-side markers. No driver accounts, no stored presence
 * rows, and no trips a matcher can assign.
 */
import { haversineMeters } from './riderShell.js'

export const SIMULATED_DRIVER_COUNT = 12
export const SIMULATED_FLEET_TICK_MS = 100
export const SIMULATED_DRIVER_TITLE = 'Busy'
export const SIMULATED_FLEET_BADGE = 'Nearby cars on the map. Demo cars cannot be requested.'
export const BUSY_MARKER_FILL = '#522D80'
export const DEMO_ORANGE = '#F56600'
export const DEMO_PURPLE = '#522D80'
/** Hide a demo car when a real online driver is at least this close. */
export const DEMO_HIDE_RADIUS_M = 250

const ROUTE_DEFS = [
  {
    id: 'sim-busy-stadium-loop',
    firstName: 'Marcus',
    headshotId: 'demo-marcus',
    year: 2025,
    colorName: 'Black',
    make: 'BMW',
    model: 'X5',
    body: 'suv',
    base: '#1A1A1A',
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
    firstName: 'Jenna',
    headshotId: 'demo-jenna',
    year: 2024,
    colorName: 'White',
    make: 'Mercedes-Benz',
    model: 'GLE',
    body: 'suv',
    base: '#F4F1EC',
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
    firstName: 'Darnell',
    headshotId: 'demo-darnell',
    year: 2026,
    colorName: 'Gray',
    make: 'Audi',
    model: 'Q7',
    body: 'suv',
    base: '#6E7278',
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
    firstName: 'Priya',
    headshotId: 'demo-priya',
    year: 2025,
    colorName: 'Black',
    make: 'Range Rover',
    model: 'Sport',
    body: 'suv',
    base: '#222326',
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
    firstName: 'Carlos',
    headshotId: 'demo-carlos',
    year: 2024,
    colorName: 'Silver',
    make: 'Lexus',
    model: 'RX',
    body: 'suv',
    base: '#C9CDD1',
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
    id: 'sim-busy-bowman',
    firstName: 'Hannah',
    headshotId: 'demo-hannah',
    year: 2025,
    colorName: 'Blue',
    make: 'Porsche',
    model: 'Macan',
    body: 'suv',
    base: '#2C4C7A',
    area: 'Bowman Field',
    routeLabel: 'Loop past Bowman Field',
    cruiseMph: 18,
    phase: 0.22,
    route: [
      { lat: 34.6782, lng: -82.8368 },
      { lat: 34.6772, lng: -82.8354 },
      { lat: 34.6764, lng: -82.8368 },
      { lat: 34.6768, lng: -82.8384 },
      { lat: 34.6780, lng: -82.8382 },
      { lat: 34.6782, lng: -82.8368 },
    ],
  },
  {
    id: 'sim-busy-library',
    firstName: 'Terrence',
    headshotId: 'demo-terrence',
    year: 2026,
    colorName: 'White',
    make: 'Cadillac',
    model: 'Escalade',
    body: 'suv',
    base: '#F7F5F2',
    area: 'Cooper Library',
    routeLabel: 'Cooper Library toward the horseshoe',
    cruiseMph: 16,
    phase: 0.48,
    route: [
      { lat: 34.6764, lng: -82.8362 },
      { lat: 34.6756, lng: -82.8350 },
      { lat: 34.6748, lng: -82.8364 },
      { lat: 34.6754, lng: -82.8378 },
      { lat: 34.6766, lng: -82.8372 },
      { lat: 34.6764, lng: -82.8362 },
    ],
  },
  {
    id: 'sim-busy-hendrix',
    firstName: 'Mei',
    headshotId: 'demo-mei',
    year: 2024,
    colorName: 'Black',
    make: 'Genesis',
    model: 'GV80',
    body: 'suv',
    base: '#141414',
    area: 'Hendrix Center',
    routeLabel: 'Hendrix Center loop',
    cruiseMph: 17,
    phase: 0.81,
    route: [
      { lat: 34.6818, lng: -82.8412 },
      { lat: 34.6826, lng: -82.8400 },
      { lat: 34.6818, lng: -82.8386 },
      { lat: 34.6808, lng: -82.8394 },
      { lat: 34.6810, lng: -82.8410 },
      { lat: 34.6818, lng: -82.8412 },
    ],
  },
  {
    id: 'sim-busy-f150-white',
    firstName: 'Wade',
    headshotId: 'demo-wade',
    year: 2025,
    colorName: 'White',
    make: 'Ford',
    model: 'F-150',
    body: 'truck',
    base: '#F4F1EC',
    area: 'Perimeter Road',
    routeLabel: 'Perimeter Road south of the stadium',
    cruiseMph: 22,
    phase: 0.11,
    route: [
      { lat: 34.6758, lng: -82.8458 },
      { lat: 34.6752, lng: -82.8436 },
      { lat: 34.6746, lng: -82.8414 },
      { lat: 34.6754, lng: -82.8402 },
      { lat: 34.6762, lng: -82.8424 },
      { lat: 34.6760, lng: -82.8448 },
      { lat: 34.6758, lng: -82.8458 },
    ],
  },
  {
    id: 'sim-busy-f150-orange',
    firstName: 'Tasha',
    headshotId: 'demo-tasha',
    year: 2025,
    colorName: 'Orange',
    make: 'Ford',
    model: 'F-150',
    body: 'truck',
    base: '#F56600',
    area: 'Williamson Road',
    routeLabel: 'Williamson Road beside the stadium',
    cruiseMph: 20,
    phase: 0.63,
    route: [
      { lat: 34.6808, lng: -82.8480 },
      { lat: 34.6820, lng: -82.8472 },
      { lat: 34.6830, lng: -82.8456 },
      { lat: 34.6822, lng: -82.8442 },
      { lat: 34.6808, lng: -82.8454 },
      { lat: 34.6802, lng: -82.8470 },
      { lat: 34.6808, lng: -82.8480 },
    ],
  },
  {
    id: 'sim-busy-f150-purple',
    firstName: 'Luis',
    headshotId: 'demo-luis',
    year: 2024,
    colorName: 'Purple',
    make: 'Ford',
    model: 'F-150',
    body: 'truck',
    base: '#522D80',
    area: 'College Avenue',
    routeLabel: 'College Avenue north of downtown',
    cruiseMph: 19,
    phase: 0.29,
    route: [
      { lat: 34.6862, lng: -82.8376 },
      { lat: 34.6870, lng: -82.8364 },
      { lat: 34.6864, lng: -82.8350 },
      { lat: 34.6852, lng: -82.8356 },
      { lat: 34.6850, lng: -82.8372 },
      { lat: 34.6858, lng: -82.8382 },
      { lat: 34.6862, lng: -82.8376 },
    ],
  },
  {
    id: 'sim-busy-cybertruck',
    firstName: 'Brooke',
    headshotId: 'demo-brooke',
    year: 2024,
    colorName: 'Stainless',
    make: 'Tesla',
    model: 'Cybertruck',
    body: 'cybertruck',
    base: '#C5C1B7',
    area: 'Downtown Clemson',
    routeLabel: 'Downtown edge along College Avenue',
    cruiseMph: 18,
    phase: 0.91,
    route: [
      { lat: 34.6838, lng: -82.8394 },
      { lat: 34.6846, lng: -82.8382 },
      { lat: 34.6842, lng: -82.8366 },
      { lat: 34.6830, lng: -82.8362 },
      { lat: 34.6824, lng: -82.8376 },
      { lat: 34.6830, lng: -82.8390 },
      { lat: 34.6838, lng: -82.8394 },
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
  headshotId: row.headshotId,
  firstName: row.firstName,
  year: row.year,
  colorName: row.colorName,
  make: row.make,
  model: row.model,
  body: row.body,
  base: row.base,
  area: row.area,
  routeLabel: row.routeLabel,
  cruiseMph: row.cruiseMph,
  phase: row.phase,
  route: row.route,
  status: 'busy',
  bookable: false,
  online: false,
  is_demo: true,
  source: 'demo',
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

export function simulatedDriverLabel(driver) {
  return `${driver.firstName}, ${driver.colorName} ${driver.make} ${driver.model}`
}

export function simulatedDriverDescription(driver) {
  return `${simulatedDriverLabel(driver)}. Demo car. Not available to request.`
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
      headshotId: driver.headshotId,
      firstName: driver.firstName,
      year: driver.year,
      colorName: driver.colorName,
      make: driver.make,
      model: driver.model,
      body: driver.body,
      base: driver.base,
      area: driver.area,
      routeLabel: driver.routeLabel,
      status: 'busy',
      bookable: false,
      online: false,
      is_demo: true,
      source: 'demo',
      lat: point.lat,
      lng: point.lng,
      heading: point.heading,
      title: simulatedDriverLabel(driver),
      description: simulatedDriverDescription(driver),
    }
  })
}

export function lerpHeading(from, to, t) {
  const amount = Math.min(1, Math.max(0, Number(t) || 0))
  const start = Number.isFinite(Number(from)) ? Number(from) : 0
  const end = Number.isFinite(Number(to)) ? Number(to) : start
  const delta = ((end - start + 540) % 360) - 180
  return (start + delta * amount + 360) % 360
}

/** Demo cars stay off the map when a real online driver is nearby. Real drivers are never removed. */
export function visibleDemoCars(cars, realDrivers, radiusM = DEMO_HIDE_RADIUS_M) {
  const real = (realDrivers || []).filter((driver) => (
    driver
    && driver.is_demo !== true
    && !isSimulatedDriverId(driver.id)
    && Number.isFinite(Number(driver.lat))
    && Number.isFinite(Number(driver.lng))
  ))
  return (cars || []).filter((car) => {
    if (!car || car.is_demo === false || car.bookable === true) return false
    return !real.some((driver) => {
      const meters = haversineMeters(
        { lat: car.lat, lng: car.lng },
        { lat: Number(driver.lat), lng: Number(driver.lng) },
      )
      return meters != null && meters <= radiusM
    })
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
const DEMO_ORANGE_FILL = DEMO_ORANGE
const DEMO_PURPLE_FILL = DEMO_PURPLE

/** Real people never receive a demo headshot. Demo cars never fall through to a real photo. */
export function portraitKind(person) {
  const id = person?.id
  const demo = person?.is_demo === true || person?.isDemo === true || isSimulatedDriverId(id)
  if (demo) return { kind: 'demo', headshotId: person?.headshotId || null, letter: null, color: null }
  const avatar = String(person?.avatarUrl || person?.avatar_url || '').trim()
  if (avatar) return { kind: 'photo', headshotId: null, letter: null, color: null }
  const name = String(person?.name || person?.firstName || '').trim()
  const letter = (name.slice(0, 1) || '?').toUpperCase()
  const seed = String(id || name || 'driver')
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i)) % 2
  return {
    kind: 'initials',
    headshotId: null,
    letter,
    color: hash === 0 ? DEMO_ORANGE_FILL : DEMO_PURPLE_FILL,
  }
}

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

function liveryStripes(body) {
  if (body === 'cybertruck') {
    return `<polygon points="18,16 30,16 28,22 16,22" fill="${DEMO_ORANGE}"/><polygon points="16,24 28,24 26,30 14,30" fill="${DEMO_PURPLE}"/>`
  }
  if (body === 'truck') {
    return `<polygon points="16,14 30,18 28,22 14,18" fill="${DEMO_ORANGE}"/><polygon points="14,24 28,28 26,32 12,28" fill="${DEMO_PURPLE}"/>`
  }
  return `<polygon points="15,14 31,18 29,22 13,18" fill="${DEMO_ORANGE}"/><polygon points="13,24 29,28 27,32 11,28" fill="${DEMO_PURPLE}"/>`
}

function bodyShape(body, base) {
  if (body === 'cybertruck') {
    return `<polygon points="24,6 34,16 32,40 16,40 14,16" fill="${base}" stroke="#ffffff" stroke-width="2"/>`
  }
  if (body === 'truck') {
    return `<rect x="14" y="8" width="20" height="16" rx="2" fill="${base}" stroke="#ffffff" stroke-width="2"/><rect x="12" y="22" width="24" height="18" rx="2" fill="${base}" stroke="#ffffff" stroke-width="2"/>`
  }
  return `<rect x="16" y="8" width="16" height="30" rx="6" fill="${base}" stroke="#ffffff" stroke-width="2"/><rect x="19" y="12" width="10" height="8" rx="2" fill="#F7F4F0"/>`
}

/** Shared demo silhouette. Orange and purple tiger-band livery, no university marks. */
export function demoCarSvg(car = {}) {
  const heading = Number.isFinite(car.heading) ? ((car.heading % 360) + 360) % 360 : 0
  const snapped = Math.round(heading / 15) * 15
  const base = car.base || '#1A1A1A'
  const body = car.body || 'suv'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64" viewBox="0 0 48 64">
    <g transform="rotate(${snapped} 24 24)">
      ${bodyShape(body, base)}
      ${liveryStripes(body)}
    </g>
  </svg>`
}

export function busyCarSvg(heading) {
  return demoCarSvg({ heading, body: 'suv', base: BUSY_MARKER_FILL })
}
