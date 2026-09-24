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
  segment: '#EFE8F6',
  segmentOn: PURPLE,
  segmentText: PURPLE,
  segmentTextOn: '#FFFFFF',
  statusBar: 'dark',
  online: '#1F7A4D',
}

/** Night uses the same orange and purple family on a deep purple field. */
export const darkPalette: Palette = {
  background: '#140E22',
  card: '#241833',
  elevated: '#2E2042',
  ink: '#F7F4F0',
  inkSecondary: '#C9B8DC',
  title: '#E4D2F8',
  orange: ORANGE,
  purple: '#C9A6E8',
  fill: PURPLE,
  onAccent: '#FFFFFF',
  border: 'rgba(228,210,248,0.16)',
  track: 'rgba(228,210,248,0.12)',
  mapFallback: '#2A1C3E',
  tabBar: '#1B122C',
  tabInactive: '#B7A4CC',
  danger: '#FF8B80',
  shadow: '#000000',
  chip: '#2E2042',
  input: '#1B122C',
  bar: '#C9A6E8',
  barPeak: ORANGE,
  segment: '#2E2042',
  segmentOn: '#C9A6E8',
  segmentText: '#E4D2F8',
  segmentTextOn: '#1B122C',
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
