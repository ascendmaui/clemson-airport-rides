/** Campus geography shared with src/components/CampusMap.jsx and RiderHome shortcuts. */
import { lookupCatalogPlace } from '../../src/lib/placeCatalog.js'

export const ORANGE = '#F56600'
export const ORANGE_BRIGHT = '#F66733'
export const PURPLE = '#522D80'
export const INK = '#0B1220'
export const INK_SECONDARY = '#5C6570'
export const DANGER = '#B42318'
export const SURFACE = '#F7F4F0'

export const CLEMSON = { latitude: 34.6784, longitude: -82.8397 }
export const STADIUM = { latitude: 34.6788, longitude: -82.843 }
export const DOWNTOWN = { latitude: 34.6836, longitude: -82.8364 }
export const GSP = { latitude: 34.8957, longitude: -82.2189 }
export const CLT = { latitude: 35.2144, longitude: -80.9473 }

export const SHORTCUTS = [
  { id: 'home', label: 'Home', sub: 'Simpsonville', icon: '🏠' },
  { id: 'clemson', label: 'Clemson University', sub: 'Sikes Hall', icon: '🎓' },
  { id: 'work', label: 'Work', sub: 'Saved place', icon: '💼' },
]

export const HEAT_WINDOWS = [
  { id: 'now', label: 'Now' },
  { id: 'weekday_am', label: 'Weekday morning' },
  { id: 'friday_night', label: 'Friday night' },
  { id: 'last_7d', label: 'Last 7 days' },
]

export const RIDE_TIERS = [
  { id: 'standard', name: 'Standard', icon: '🚗', eta: '4 min', meta: '4 seats', price: 18.5 },
  { id: 'wait', name: 'Wait & Save', icon: '⏱️', eta: '12 min', meta: 'Save ~20%', price: 14.2 },
  { id: 'comfort', name: 'Extra Comfort', icon: '✨', eta: '6 min', meta: 'Newer cars', price: 23 },
  { id: 'xl', name: 'XL', icon: '🚐', eta: '8 min', meta: '6 seats', price: 28.75 },
  { id: 'pet', name: 'Pet', icon: '🐶', eta: '9 min', meta: 'Pet-friendly', price: 21 },
  { id: 'tesla', name: 'Tesla Model 3', icon: '⚡', eta: '7 min', meta: 'Clemson fleet · a driver is at the wheel', price: 36, premium: true },
]

const DEST_POINTS = [
  { test: /gsp|greenville/, point: GSP },
  { test: /\bclt\b|charlotte/, point: CLT },
  { test: /sikes/, point: { latitude: 34.6795, longitude: -82.8374 } },
  { test: /simpsonville/, point: { latitude: 34.5868, longitude: -82.2543 } },
  { test: /stadium|death valley/, point: STADIUM },
]

function pointForLabel(label, fallback) {
  const found = lookupCatalogPlace(label)
  if (found) return { latitude: found.lat, longitude: found.lng }
  const key = String(label || '').trim().toLowerCase()
  for (const row of DEST_POINTS) {
    if (row.test.test(key)) return row.point
  }
  return fallback
}

export function destPoint(label) {
  return pointForLabel(label, GSP)
}

export function pickupPoint(label) {
  return pointForLabel(label, STADIUM)
}

export function formatUsd(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${n.toFixed(2)}`
}
