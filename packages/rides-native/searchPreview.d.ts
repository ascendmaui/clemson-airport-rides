export const SEARCH_DEMO_CYCLE_MS: number
export const SEARCH_MAP_ZOOM_MS: number
export const SEARCH_MAP_DELTA_START: number
export const SEARCH_MAP_DELTA_END: number

export type DemoPaint = { fill: string; edge: string; ink: string }

export type SearchingDemoCard = {
  id: string
  firstName: string
  vehicleLabel: string
  initials: string
  paint: DemoPaint
  body: string
  livery: string
  isDemo: true
  source: 'demo'
  bookable: false
  online: false
  matched: false
  affectsAvailability: false
  affectsEta: false
  affectsPrice: false
  etaMin: null
  priceCents: null
  previewMeters: number
  previewRank: number
}

export type PickupLike = { lat?: number; lng?: number; latitude?: number; longitude?: number } | null | undefined

export function demoCarPaint(driver: { livery?: string | null } | null | undefined): DemoPaint
export function searchingDemoIndex(elapsedMs: number, count?: number): number
export function searchingDemoRanked(nowMs: number, pickup?: PickupLike): SearchingDemoCard[]
export function searchingDemoPair(elapsedMs: number, nowMs: number, pickup?: PickupLike): {
  current: SearchingDemoCard
  next: SearchingDemoCard
  rankedCount: number
}
export function searchMapCenter(): { latitude: number; longitude: number }
export function searchMapRegion(elapsedMs: number): {
  latitude: number
  longitude: number
  latitudeDelta: number
  longitudeDelta: number
  progress: number
}
