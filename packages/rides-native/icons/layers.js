import { GLYPHS } from './glyphs.js'
import { ICON_TOKENS, ION_ALIASES } from './tokens.js'

export function resolveIconName(name) {
  if (GLYPHS[name]) return name
  return ION_ALIASES[name] || 'info'
}

/**
 * Optical sizing: thin strokes scale up as glyphs shrink so 16px rows stay
 * crisp and 32px+ hero badges do not look heavy. Values are in 24-grid units.
 */
export function opticalStroke(size = 24) {
  if (size <= 16) return 1.95
  if (size <= 20) return 1.8
  if (size <= 26) return 1.65
  if (size <= 34) return 1.5
  return 1.4
}

/**
 * Platform-neutral layer list for a glyph. Icon.jsx and the sheet renderer
 * both draw from this so the shipped icon and the review sheet never drift.
 * kind: wash | fill | specular | stroke | knock | accent
 */
export function glyphLayers(name, { active = false, scheme = 'light', color, knockout, size = 24, strokeWidth } = {}) {
  const t = scheme === 'dark' ? ICON_TOKENS.dark : ICON_TOKENS.light
  const g = GLYPHS[resolveIconName(name)]
  const sw = strokeWidth || opticalStroke(size)
  const tint = color || (active ? t.orange : t.ink)
  const accent = color && color !== t.ink ? color : t.orange
  const filled = active && !!g.f
  const out = []
  if (g.f && !active) for (const d of g.f) out.push({ kind: 'wash', d, fill: accent, opacity: t.wash })
  if (filled) {
    for (const d of g.f) out.push({ kind: 'fill', d, gradient: [lighten(tint), tint, deepen(tint, t)] })
    for (const d of g.f) out.push({ kind: 'specular', d })
  }
  for (const d of g.s) out.push({ kind: 'stroke', d, stroke: tint, strokeWidth: sw })
  if (filled && g.k) for (const d of g.k) out.push({ kind: 'knock', d, stroke: knockout || t.surface, strokeWidth: sw })
  if (g.a) for (const d of g.a) out.push({ kind: 'accent', d, fill: filled ? knockout || t.surface : active ? tint : accent })
  return out
}

function deepen(c, t) {
  if (c === t.orange) return t.orangeDeep
  if (c === t.purple || c === t.purpleLight) return t.purpleDeep
  return mix(c, '#000000', 0.22)
}
function lighten(c) { return mix(c, '#FFFFFF', 0.28) }
export function mix(a, b, w) {
  if (!/^#[0-9a-f]{6}$/i.test(a)) return a
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * w).toString(16).padStart(2, '0')).join('')
}

/** SVG string, for web previews, sheets and snapshot tests. */
export function glyphSvg(name, opts = {}) {
  const size = opts.size || 24
  const id = `g${Math.random().toString(36).slice(2, 8)}`
  let defs = ''
  const body = glyphLayers(name, opts).map((l, i) => {
    if (l.kind === 'fill') {
      defs += `<linearGradient id="${id}f${i}" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${l.gradient[0]}"/><stop offset="0.45" stop-color="${l.gradient[1]}"/><stop offset="1" stop-color="${l.gradient[2]}"/></linearGradient>`
      return `<path d="${l.d}" fill="url(#${id}f${i})"/>`
    }
    if (l.kind === 'specular') {
      defs += `<linearGradient id="${id}s${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.42"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>`
      return `<path d="${l.d}" fill="url(#${id}s${i})"/>`
    }
    if (l.kind === 'wash' || l.kind === 'accent') return `<path d="${l.d}" fill="${l.fill}"${l.opacity ? ` fill-opacity="${l.opacity}"` : ''}/>`
    return `<path d="${l.d}" fill="none" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}
