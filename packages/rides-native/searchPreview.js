/**
 * Looking-for-a-driver preview only.
 * Map zoom and the cycling names are client-side. They use the demo fleet,
 * which stays offline and unbookable, so they never enter matching, ETA, or price.
 * Car motion itself stays on the existing campus cruise speeds in simulatedDrivers.
 */
import { CLEMSON } from './places.js'
import { haversineMeters } from './riderShell.js'
import { SIMULATED_DRIVERS, SIMULATED_FLEET_BOUNDS, simulatedFleetAt } from './simulatedDrivers.js'

export const SEARCH_DEMO_CYCLE_MS = 3200
export const SEARCH_MAP_ZOOM_MS = 20000
export const SEARCH_MAP_DELTA_START = 0.013
export const SEARCH_MAP_DELTA_END = 0.042

const PAINT = {
  tiger: { fill: '#F56600', edge: '#522D80', ink: '#FFFFFF' },
  'f150-orange': { fill: '#F56600', edge: '#522D80', ink: '#FFFFFF' },
  'f150-purple': { fill: '#522D80', edge: '#F56600', ink: '#FFFFFF' },
  'f150-white': { fill: '#F4F1EC', edge: '#522D80', ink: '#522D80' },
  wedge: { fill: '#D5D7D8', edge: '#F56600', ink: '#522D80' },
}

export function demoCarPaint(driver) {
  const livery = driver?.livery || 'tiger'
  return PAINT[livery] || PAINT.tiger
}

function finiteMs(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}

export function searchingDemoIndex(elapsedMs, count = SIMULATED_DRIVERS.length) {
  const size = Math.max(1, Number(count) || 1)
  return Math.floor(finiteMs(elapsedMs) / SEARCH_DEMO_CYCLE_MS) % size
}

function pickupPoint(pickup) {
  const lat = Number(pickup?.lat ?? pickup?.latitude)
  const lng = Number(pickup?.lng ?? pickup?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { lat: CLEMSON.latitude, lng: CLEMSON.longitude }
  }
  return { lat, lng }
}

function cardFor(driver, car, meters) {
  const firstName = driver?.firstName || car?.firstName || 'Driver'
  return {
    id: driver?.id || car?.id,
    firstName,
    vehicleLabel: driver?.label || car?.label || 'Vehicle',
    initials: firstName.slice(0, 1).toUpperCase(),
    paint: demoCarPaint(driver || car),
    body: driver?.body || car?.body || 'suv',
    livery: driver?.livery || car?.livery || 'tiger',
    isDemo: true,
    source: 'demo',
    bookable: false,
    online: false,
    matched: false,
    affectsAvailability: false,
    affectsEta: false,
    affectsPrice: false,
    etaMin: null,
    priceCents: null,
    previewMeters: Number.isFinite(meters) ? meters : Number.POSITIVE_INFINITY,
  }
}

/**
 * Display order for the searching card. Closer to pickup ranks first.
 * previewRank is visual only. online and bookable stay false.
 */
export function searchingDemoRanked(nowMs, pickup) {
  const origin = pickupPoint(pickup)
  const byId = new Map(SIMULATED_DRIVERS.map((driver) => [driver.id, driver]))
  const cards = simulatedFleetAt(finiteMs(nowMs)).map((car) => {
    const meters = haversineMeters({ lat: car.lat, lng: car.lng }, origin)
    return cardFor(byId.get(car.id), car, meters)
  })
  cards.sort((a, b) => a.previewMeters - b.previewMeters || String(a.id).localeCompare(String(b.id)))
  return cards.map((card, index) => ({ ...card, previewRank: index + 1 }))
}

/** Two consecutive ranks. The first is the better preview rank in that window. */
export function searchingDemoPair(elapsedMs, nowMs, pickup) {
  const elapsed = finiteMs(elapsedMs)
  const sampleAt = Math.max(0, finiteMs(nowMs) - (elapsed % SEARCH_DEMO_CYCLE_MS))
  const ranked = searchingDemoRanked(sampleAt, pickup)
  const index = searchingDemoIndex(elapsed, ranked.length)
  const current = ranked[index]
  const next = ranked[(index + 1) % ranked.length]
  return { current, next, rankedCount: ranked.length }
}

export function searchMapCenter() {
  const { minLat, maxLat, minLng, maxLng } = SIMULATED_FLEET_BOUNDS
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
  }
}

/** Ease-out zoom from a tight Clemson frame to a wider one. */
export function searchMapRegion(elapsedMs) {
  const t = Math.min(1, finiteMs(elapsedMs) / SEARCH_MAP_ZOOM_MS)
  const eased = 1 - (1 - t) ** 3
  const latitudeDelta = SEARCH_MAP_DELTA_START + (SEARCH_MAP_DELTA_END - SEARCH_MAP_DELTA_START) * eased
  return {
    ...searchMapCenter(),
    latitudeDelta,
    longitudeDelta: latitudeDelta,
    progress: t,
  }
}
