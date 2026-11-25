/**
 * Visual tokens shared by the rider and driver apps.
 * Brand hex values live in places.js. These objects are the type, space,
 * radius, shadow, and motion scale used by both surfaces.
 */
import { DANGER, INK, INK_SECONDARY, ORANGE, ORANGE_BRIGHT, PURPLE, SURFACE } from '../places.js'

export { DANGER, INK, INK_SECONDARY, ORANGE, ORANGE_BRIGHT, PURPLE, SURFACE }

export const color = {
  orange: ORANGE,
  orangeBright: ORANGE_BRIGHT,
  purple: PURPLE,
  ink: INK,
  inkSecondary: INK_SECONDARY,
  danger: DANGER,
  surface: SURFACE,
  white: '#FFFFFF',
  shadow: '#1A1033',
}

/** 4px grid used on rider sheets, cards, and the driver stack pages. */
export const space = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  screen: 16,
}

export const radius = {
  xs: 10,
  sm: 12,
  control: 14,
  lg: 18,
  xl: 22,
  panel: 20,
  sheet: 28,
  pill: 999,
}

export const type = {
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  kickerSm: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  headline: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  cardTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  section: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  button: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  amount: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  meta: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
}

export const elevation = {
  rest: {
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  float: {
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  bar: {
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  darkRest: {
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
}

/** Rider enter motion: fade 320ms, rise 380ms, cubic out. Press scale matches Button. */
export const motion = {
  enterFadeMs: 320,
  enterRiseMs: 380,
  enterDistance: 12,
  pressOpacity: 0.92,
  pressScale: 0.985,
  disabledOpacity: 0.55,
  pressDurationMs: 120,
}

export function motionDuration(ms, reduceMotion) {
  if (reduceMotion) return 0
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}

export function elevationFor(level, scheme = 'light') {
  switch (level) {
    case 'float':
      return elevation.float
    case 'bar':
      return elevation.bar
    case 'rest':
      return scheme === 'dark' ? elevation.darkRest : elevation.rest
    default: {
      throw new Error(`Unknown elevation ${String(level)}`)
    }
  }
}

export function shadowStyle(shadowColor, level = 'rest', scheme = 'light') {
  const recipe = elevationFor(level, scheme)
  return {
    shadowColor,
    shadowOpacity: recipe.shadowOpacity,
    shadowRadius: recipe.shadowRadius,
    shadowOffset: { width: recipe.shadowOffset.width, height: recipe.shadowOffset.height },
    elevation: recipe.elevation,
  }
}

/** The one brand glow (Driver GO button, offer gauge tiers). */
export const glow = {
  shadowOpacity: 0.35,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
}

function hexAlpha(hex, alpha) {
  const raw = String(hex || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(raw)) return hex
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Coloured glow. iOS draws a tinted shadow. Android elevation shadows are grey
 * (tinted only on API 28+), so Android also gets a soft ring in the glow colour.
 */
export function glowStyle(glowColor, platform = 'ios') {
  const base = {
    shadowColor: glowColor,
    shadowOpacity: glow.shadowOpacity,
    shadowRadius: glow.shadowRadius,
    shadowOffset: { width: glow.shadowOffset.width, height: glow.shadowOffset.height },
    elevation: glow.elevation,
  }
  if (platform !== 'android') return base
  return { ...base, borderWidth: 3, borderColor: hexAlpha(glowColor, 0.55) }
}
