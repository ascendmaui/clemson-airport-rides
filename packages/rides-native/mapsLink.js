/**
 * Turn a stop into Apple Maps, Google Maps and Waze directions URLs.
 * Callers open them with the platform linker. No SDK key. Every URL is https
 * or http (no custom scheme), so no LSApplicationQueriesSchemes entry is needed.
 */

function coord(value) {
  // Number(null), Number(''), and Number(false) are 0. A missing coordinate
  // must stay missing so directions do not open at (0, 0).
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function navigationLinks({ latitude, longitude, label } = {}) {
  const lat = coord(latitude)
  const lng = coord(longitude)
  const name = String(label || '').trim()
  const query = encodeURIComponent(name || 'Destination')
  const hasPoint = lat != null && lng != null
  const apple = hasPoint
    ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${query}&dirflg=d`
    : `http://maps.apple.com/?q=${query}`
  const google = hasPoint
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`
  const waze = hasPoint
    ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    : `https://waze.com/ul?q=${query}&navigate=yes`
  return { apple, google, waze, hasPoint }
}

export const NAV_APPS = Object.freeze(['apple', 'google', 'waze'])

export function isNavApp(value) {
  return NAV_APPS.includes(value)
}

export function navAppLabel(app) {
  if (app === 'google') return 'Google Maps'
  if (app === 'waze') return 'Waze'
  return 'Apple Maps'
}

/** Preferred app first, then the rest in a stable order. Used for buttons and open fallbacks. */
export function navAppOrder(preferred) {
  const first = isNavApp(preferred) ? preferred : 'apple'
  return [first, ...NAV_APPS.filter((app) => app !== first)]
}

/** One URL for the driver's chosen nav app. Unknown apps open Apple Maps. */
export function navigationUrl(app, stop) {
  const links = navigationLinks(stop || {})
  return links[isNavApp(app) ? app : 'apple']
}

/** One URL for a Navigate button. iPhone opens Apple Maps; everyone else opens Google Maps. */
export function preferredNavigationUrl(stop, userAgent = '') {
  const links = navigationLinks(stop)
  const ios = /iPhone|iPad|iPod/i.test(String(userAgent || ''))
  return ios ? links.apple : links.google
}
