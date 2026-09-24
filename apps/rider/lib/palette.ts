// Relative path so `npm test` can load these tokens without the Metro alias.
import { DANGER, INK, INK_SECONDARY, ORANGE, ORANGE_BRIGHT, PURPLE, SURFACE } from '../../../packages/rides-native/places.js'

export type Scheme = 'light' | 'dark'

export type Palette = {
  background: string
  card: string
  elevated: string
  ink: string
  inkSecondary: string
  title: string
  link: string
  orange: string
  orangeBright: string
  purple: string
  fill: string
  onAccent: string
  border: string
  track: string
  orangeSoft: string
  purpleSoft: string
  scrim: string
  placeholder: string
  mapFallback: string
  tabBar: string
  tabInactive: string
  danger: string
  shadow: string
  chip: string
  input: string
  segment: string
  segmentOn: string
  segmentText: string
  segmentTextOn: string
  statusBar: 'light' | 'dark'
  online: string
  onlineSoft: string
}

export const lightPalette: Palette = {
  background: SURFACE,
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  ink: INK,
  inkSecondary: INK_SECONDARY,
  title: PURPLE,
  link: PURPLE,
  orange: ORANGE,
  orangeBright: ORANGE_BRIGHT,
  purple: PURPLE,
  fill: PURPLE,
  onAccent: '#FFFFFF',
  border: 'rgba(82,45,128,0.12)',
  track: 'rgba(82,45,128,0.1)',
  orangeSoft: 'rgba(245,102,0,0.12)',
  purpleSoft: 'rgba(82,45,128,0.08)',
  scrim: 'rgba(11,18,32,0.42)',
  placeholder: '#8B939E',
  mapFallback: '#E4D7F2',
  tabBar: 'rgba(255,255,255,0.96)',
  tabInactive: '#8B939E',
  danger: DANGER,
  shadow: '#1A1033',
  chip: '#FFFFFF',
  input: '#FFFFFF',
  segment: '#EFE8F6',
  segmentOn: PURPLE,
  segmentText: PURPLE,
  segmentTextOn: '#FFFFFF',
  statusBar: 'dark',
  online: '#1F7A4D',
  onlineSoft: 'rgba(31,138,76,0.10)',
}

/**
 * Night field shared with the driver app.
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
  link: '#D4C4F0',
  orange: ORANGE,
  orangeBright: ORANGE_BRIGHT,
  purple: PURPLE,
  fill: PURPLE,
  onAccent: '#FFFFFF',
  border: 'rgba(245,246,248,0.14)',
  track: 'rgba(245,246,248,0.12)',
  orangeSoft: 'rgba(245,102,0,0.18)',
  purpleSoft: 'rgba(212,196,240,0.12)',
  scrim: 'rgba(0,0,0,0.62)',
  placeholder: '#8E879C',
  mapFallback: '#120E18',
  tabBar: '#0E0B14',
  tabInactive: '#A7A2B3',
  danger: '#FF8B80',
  shadow: '#000000',
  chip: '#1E192A',
  input: '#120E18',
  segment: '#16121F',
  segmentOn: PURPLE,
  segmentText: '#F5F6F8',
  segmentTextOn: '#FFFFFF',
  statusBar: 'light',
  online: '#7DCEA0',
  onlineSoft: 'rgba(125,206,160,0.16)',
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
