export type DemandCell = {
  id: string
  lat: number
  lng: number
  demand: number
  requests: number
  pickups: number
  scheduled: number
  airport: number
  intensity: number
  fading?: boolean
}
export type DemandResult = { cells: DemandCell[] | null; error: string | null; at: number }
export const DEMAND_RPC: string
export const DEMAND_REFRESH_MS: number
export const DEMAND_WINDOW_MINUTES: number
export const PEAK_WINDOW_MINUTES: number
export const CELL_LAT_DEG: number
export const CELL_LNG_DEG: number
export const MAX_RENDER_CELLS: number
export function distanceMeters(a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null): number | null
export function cellFor(lat: number, lng: number): { id: string; lat: number; lng: number }
export function decayWeight(ageMinutes: number, windowMinutes?: number): number
export function aggregateDemand(events: any[], opts?: { now?: number; windowMinutes?: number; airportMultiplier?: number }): any[]
export function normalizeDemandCells(rows: any[], opts?: { peak?: boolean; limit?: number }): DemandCell[]
export function demandLevel(intensity: number): string
export function estimatedDemand(cell: DemandCell): { low: number; high: number; label: string }
export function formatDistance(meters: number | null): string | null
export function describeCell(cell: DemandCell | null, driver?: { lat: number; lng: number } | null): { title: string; estimate: string; detail: string; distance: string | null; meters: number | null } | null
export function heatRgb(intensity: number, scheme?: 'light' | 'dark'): [number, number, number]
export function heatLayers(intensity: number, scheme?: 'light' | 'dark'): { halo: string; body: string; core: string; stroke: string }
export function cellRing(cell: { lat: number; lng: number }, scale?: number, steps?: number): { latitude: number; longitude: number }[]
export function tweenCells(from: DemandCell[], to: DemandCell[], t: number): DemandCell[]
export function quantize(intensity: number, steps?: number): number
export function topDemandZones(cells: DemandCell[], opts?: { minIntensity?: number; limit?: number }): DemandCell[]
export function fetchDemandCells(supabase: any, opts?: { peak?: boolean; windowMinutes?: number }): Promise<DemandResult>
export function subscribeDemandCells(supabase: any, opts?: { peak?: boolean; onData?: (r: DemandResult) => void; intervalMs?: number; appState?: any }): () => void
