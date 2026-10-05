/**
 * Original car silhouettes for the rider map.
 * Orange #F56600 and purple #522D80 tiger stripes. No wordmarks.
 */
const PALETTES = {
  tiger: { body: '#F56600', stripe: '#522D80', glass: '#F7F4F0', trim: '#3d215f' },
  'f150-white': { body: '#F4F1EC', stripe: '#522D80', glass: '#E7E0F2', trim: '#F56600' },
  'f150-orange': { body: '#F56600', stripe: '#522D80', glass: '#F7F4F0', trim: '#3d215f' },
  'f150-purple': { body: '#522D80', stripe: '#F56600', glass: '#F7F4F0', trim: '#2a1744' },
  wedge: { body: '#D5D7D8', stripe: '#F56600', glass: '#2A2430', trim: '#522D80' },
}

function snapHeading(heading) {
  const deg = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0
  return Math.round(deg / 15) * 15
}

function stripes(palette) {
  return `<path d="M8 16 H40 M10 22 H38 M12 28 H36" stroke="${palette.stripe}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
}

function bodyPath(body) {
  if (body === 'truck') {
    return `<path d="M6 30 L10 18 H22 L26 12 H34 L40 18 H44 L46 30 Z" fill="currentColor"/>
      <rect x="8" y="30" width="8" height="6" rx="2" fill="#1c1c1c"/>
      <rect x="32" y="30" width="8" height="6" rx="2" fill="#1c1c1c"/>`
  }
  if (body === 'wedge') {
    return `<path d="M4 30 L14 14 H36 L46 30 Z" fill="currentColor"/>
      <rect x="8" y="30" width="8" height="5" rx="2" fill="#1c1c1c"/>
      <rect x="32" y="30" width="8" height="5" rx="2" fill="#1c1c1c"/>`
  }
  return `<path d="M8 30 L12 16 H20 L24 10 H36 L40 16 H42 L44 30 Z" fill="currentColor"/>
    <rect x="9" y="30" width="8" height="6" rx="2" fill="#1c1c1c"/>
    <rect x="31" y="30" width="8" height="6" rx="2" fill="#1c1c1c"/>`
}

export function fleetCarSvg({ heading = 0, body = 'suv', livery = 'tiger' } = {}) {
  const palette = PALETTES[livery] || PALETTES.tiger
  const snapped = snapHeading(heading)
  const shape = body === 'truck' || body === 'wedge' ? body : 'suv'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <g transform="rotate(${snapped} 24 24)" color="${palette.body}">
      ${bodyPath(shape)}
      ${stripes(palette)}
      <path d="M16 16 H32 L34 22 H14 Z" fill="${palette.glass}"/>
      <rect x="6" y="26" width="4" height="3" rx="1" fill="${palette.trim}"/>
    </g>
  </svg>`
}

export function initialsMarkerSvg(initials, color) {
  const text = String(initials || '?').slice(0, 2)
  const fill = color === '#522D80' ? '#522D80' : '#F56600'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
    <text x="18" y="22" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="12" font-weight="700">${text}</text>
  </svg>`
}
