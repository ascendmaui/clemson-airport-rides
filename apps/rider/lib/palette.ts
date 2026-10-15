// Relative path so `npm test` can load these tokens without the Metro alias.
import { color } from '../../../packages/rides-native/shared/theme.js'

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
  /** Small text. Brand orange is about 3:1 on white, under AA. */
  orangeInk: string
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
  background: color.surface,
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  ink: color.ink,
  inkSecondary: color.inkSecondary,
  title: color.purple,
  link: color.purple,
  orange: color.orange,
  orangeBright: color.orangeBright,
  orangeInk: '#9A3F00',
  purple: color.purple,
  fill: color.purple,
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
  danger: color.danger,
  shadow: '#1A1033',
  chip: '#FFFFFF',
  input: '#FFFFFF',
  segment: '#EFE8F6',
  segmentOn: color.purple,
  segmentText: color.purple,
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
  orange: color.orange,
  orangeBright: color.orangeBright,
  orangeInk: '#FFC9A3',
  purple: color.purple,
  fill: color.purple,
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
  segmentOn: color.purple,
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

/** Fixed colours that do not follow the app scheme. Screens import these instead of raw hex. */
export const mapUnavailableColors = { surface: '#F4F5F8', body: '#5B6472' } as const

/** Web search-theater backdrop behind the preview cars. */
export const searchTheaterColors = { stage: '#1B2836', field: '#243447' } as const

/** Paw drawn on the orange loader disc. */
export const pawInk = '#1A1033'

/** Demand-heat label ink. Tests pin this to the dark brown used on the wash. */
export const heatInk = '#1F1208'

/** Heat labels: no white halo on a dark map. */
export const heatLabelColors = {
  light: { chip: 'rgba(255,252,248,0.94)', shadow: 'rgba(255,255,255,0.9)' },
  dark: { chip: 'rgba(22,18,31,0.94)', shadow: 'rgba(0,0,0,0.9)' },
} as const

export function heatLabelFor(scheme: Scheme): { chip: string; shadow: string } {
  switch (scheme) {
    case 'light':
      return heatLabelColors.light
    case 'dark':
      return heatLabelColors.dark
    default: {
      const unknown: never = scheme
      return unknown
    }
  }
}

/** SOS is a fixed red field in both schemes. White type sits on that field, not on a dark card. */
export const emergencyColors = {
  gradient: ['#4A0C0C', '#B42318', '#6E1212'] as const,
  fab: '#B42318',
  banner: '#3B1020',
  field: '#6E1212',
  breathe: '#FF8A75',
  ink: '#FFE4DC',
  call: '#9B1B1B',
  shadow: '#3B0707',
} as const
