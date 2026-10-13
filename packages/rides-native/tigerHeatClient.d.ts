import type { TigerHeatZone } from './tigerHeat.js'

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
  error: string | null
}>
