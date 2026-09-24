import { DANGER, INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

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
}

export const lightPalette: Palette = {
  background: SURFACE,
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  ink: INK,
  inkSecondary: INK_SECONDARY,
  title: PURPLE,
  orange: ORANGE,
  purple: PURPLE,
  fill: PURPLE,
  onAccent: '#FFFFFF',
  border: 'rgba(82,45,128,0.12)',
  track: 'rgba(82,45,128,0.1)',
  mapFallback: '#E4D7F2',
  tabBar: '#FFFFFF',
  tabInactive: INK_SECONDARY,
  danger: DANGER,
  shadow: '#1A1033',
  chip: '#FFFFFF',
  input: SURFACE,
  bar: PURPLE,
  barPeak: ORANGE,
  goStart: '#FF7A1A',
  segment: '#EFE8F6',
  segmentOn: PURPLE,
  segmentText: PURPLE,
  segmentTextOn: '#FFFFFF',
  statusBar: 'dark',
  online: '#1F7A4D',
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
  orange: ORANGE,
  purple: PURPLE,
  fill: PURPLE,
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
  bar: PURPLE,
  barPeak: ORANGE,
  goStart: '#FF7A1A',
  segment: '#16121F',
  segmentOn: PURPLE,
  segmentText: '#F5F6F8',
  segmentTextOn: '#FFFFFF',
  statusBar: 'light',
  online: '#7DCEA0',
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
