import type { PeakStatus, TigerHeatZone } from './tigerHeat.js'

export function fetchTigerHeatMap(windowId?: string, options?: {
  fetchImpl?: typeof fetch
  base?: string
}): Promise<{
  label: string
  windowId: string
  activation: string
  zones: TigerHeatZone[]
  deactivated: unknown[]
  solvency: unknown
  durationPolicy: unknown
  peak: PeakStatus
  error: string | null
}>

export function fetchPeakStatus(options?: {
  fetchImpl?: typeof fetch
  base?: string
}): Promise<PeakStatus>
