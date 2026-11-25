import type { PeakStatus } from './tigerHeat.js'

export function peakSurgeView(peak: PeakStatus | null | undefined, online?: boolean): {
  multiplierLabel: string
  headline: string
  line: string
} | null
