import { color } from 'rides-native/shared/theme.js'

export type Scheme = 'light' | 'dark'

export type Palette = {
  background: string
  card: string
  elevated: string
  ink: string
  inkSecondary: string
  title: string
  orange: string
  purple: string
  fill: string
  onAccent: string
  border: string
  track: string
  mapFallback: string
  tabBar: string
  tabInactive: string
  danger: string
  shadow: string
  chip: string
  input: string
  bar: string
  barPeak: string
  goStart: string
  segment: string
  segmentOn: string
  segmentText: string
  segmentTextOn: string
  statusBar: 'light' | 'dark'
  online: string
  onlineSoft: string
  orangeSoft: string
  purpleSoft: string
  link: string
  placeholder: string
  scrim: string
}

export const lightPalette: Palette = {
  background: color.surface,
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  ink: color.ink,
  inkSecondary: color.inkSecondary,
  title: color.purple,
  orange: color.orange,
  purple: color.purple,
  fill: color.purple,
  onAccent: '#FFFFFF',
  border: 'rgba(82,45,128,0.12)',
  track: 'rgba(82,45,128,0.1)',
  mapFallback: '#E4D7F2',
  tabBar: '#FFFFFF',
  tabInactive: color.inkSecondary,
  danger: color.danger,
  shadow: '#1A1033',
  chip: '#FFFFFF',
  input: color.surface,
  bar: color.purple,
  barPeak: color.orange,
  goStart: '#FF7A1A',
  segment: '#EFE8F6',
  segmentOn: color.purple,
  segmentText: color.purple,
  segmentTextOn: '#FFFFFF',
  statusBar: 'dark',
  online: '#1F7A4D',
  onlineSoft: 'rgba(31,138,76,0.10)',
  orangeSoft: 'rgba(245,102,0,0.12)',
  purpleSoft: 'rgba(82,45,128,0.08)',
  link: color.purple,
  placeholder: '#8B939E',
  scrim: 'rgba(11,18,32,0.42)',
}

/**
 * Proposed night field from the Clemson theme preview.
 * Surface #0E0B14, muted cards #16121F, ink #F5F6F8.
 * Orange and purple stay #F56600 and #522D80.
 */
export const darkPalette: Palette = {
  background: '#0E0B14',
  card: '#16121F',
  elevated: '#1E192A',
  ink: '#F5F6F8',
  inkSecondary: '#A7A2B3',
  title: '#F5F6F8',
  orange: color.orange,
  purple: color.purple,
  fill: color.purple,
  onAccent: '#FFFFFF',
  border: 'rgba(245,246,248,0.14)',
  track: 'rgba(245,246,248,0.12)',
  mapFallback: '#120E18',
  tabBar: '#0E0B14',
  tabInactive: '#A7A2B3',
  danger: '#FF8B80',
  shadow: '#000000',
  chip: '#1E192A',
  input: '#120E18',
  bar: color.purple,
  barPeak: color.orange,
  goStart: '#FF7A1A',
  segment: '#16121F',
  segmentOn: color.purple,
  segmentText: '#F5F6F8',
  segmentTextOn: '#FFFFFF',
  statusBar: 'light',
  online: '#7DCEA0',
  onlineSoft: 'rgba(125,206,160,0.16)',
  orangeSoft: 'rgba(245,102,0,0.18)',
  purpleSoft: 'rgba(212,196,240,0.12)',
  link: '#D4C4F0',
  placeholder: '#8E879C',
  scrim: 'rgba(0,0,0,0.62)',
}

export function paletteFor(scheme: Scheme): Palette {
  switch (scheme) {
    case 'light':
      return lightPalette
    case 'dark':
      return darkPalette
    default: {
      const unknown: never = scheme
      return unknown
    }
  }
}

/**
 * Named fixed colours for surfaces that do not follow the app scheme.
 * Screens import these instead of writing raw hex.
 */
/** Heat-map card and legend: follow the *map* style (dark map at night), not the app scheme. */
export const mapHeatColors = {
  light: { surface: '#FFFFFF', title: '#1B1B1F', estimate: '#9A3F00', body: '#3E4654', legend: 'rgba(255,255,255,0.92)', border: 'rgba(82,45,128,0.12)' },
  dark: { surface: '#16121F', title: '#FFFFFF', estimate: '#FFC9A3', body: '#D5D0DC', legend: 'rgba(22,18,31,0.9)', border: 'rgba(255,255,255,0.14)' },
} as const

/** Android "map unavailable" placeholder (shown before tiles load). */
export const mapUnavailableColors = { surface: '#F4F5F8', body: '#5B6472' } as const

/** Offer gauge "crown" tier: white arc on the gold gradient, warm sparkles. */
export const gaugeCrownColors = { arc: '#FFFFFF', sparkle: '#FFE9A8', sparkleDefault: '#FFFFFF' } as const

/** Earnings hero sits on a fixed purple gradient in light mode. */
export const earningsHeroColors = { gradientEnd: '#3C1E66', kickerOnPurple: '#FFD8B8', cashInk: '#1A1033' } as const

/** Tips slice in the earnings split chart. */
export const tipsColor = '#22A04B'

/** Signature canvas stays white paper with dark ink in both schemes, like a printed form. */
export const signatureColors = { ink: '#111111', surface: '#FFFFFF', border: '#D7D3DE', hint: '#8B939E' } as const

/** Web fallback for the offer route preview (light lilac card). */
export const routePreviewColors = { surface: '#E7E1F2', label: '#16121F' } as const
