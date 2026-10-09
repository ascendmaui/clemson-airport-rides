export const TIGER_HEAT_ORANGE: string
export const TIGER_HEAT_PURPLE: string
export const TIGER_HEAT_LABEL: string
export const LIVE_WINDOW_MS: number
export const LIVE_MIN_REQUESTS: number
export const PREVIEW_INTENSITY: number
export const BONUS_CAP_CENTS: number
export const DURATION_BASELINE_MINUTES: number
export const DURATION_CENTS_PER_MINUTE: number
export const DURATION_GAME_DAY_CENTS_PER_MINUTE: number

export type TigerHeatLevel = 'rare' | 'great' | 'peak' | 'reduced'
export type TigerHeatActivation = 'live' | 'preview-clock' | 'preview-history'

export type TigerHeatPoint = { lat: number; lng: number }

export type TigerHeatZone = {
  id: string
  name: string
  lat: number
  lng: number
  radius: number
  requestCount: number
  intensity: number
  bonusCents: number
  bonusLabel: string
  payable: boolean
  preview: boolean
  source: string
  heatLevel: TigerHeatLevel | null
  fillColor: string
  strokeColor: string
  polygon: TigerHeatPoint[]
  innerPolygon: TigerHeatPoint[]
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number | null
export function offsetPoint(lat: number, lng: number, radiusM: number, bearingRad: number): TigerHeatPoint
export function circlePolygon(lat: number, lng: number, radiusM: number, steps?: number): TigerHeatPoint[]
export function toNativeRing(polygon: TigerHeatPoint[]): { latitude: number; longitude: number }[]
export function bonusCentsFromRequestCount(count: number): number
export function bonusCentsFromPreviewIntensity(intensity: number): number
export function heatLevelForCents(cents: number): TigerHeatLevel | null
export function formatTigerHeatLabel(bonusCents: number, options?: { preview?: boolean }): string
export function applyDurationBonus(baseCents: number, durationMinutes: number, gameDay?: boolean): {
  bonusCents: number
  durationAdjustmentCents: number
  capped: boolean
}
export function tripDurationMinutes(trip: { accepted_at?: string; created_at?: string } | null | undefined, completedAt?: Date | string): number
export function countRequestsInZone(zone: { lat: number; lng: number; radius: number }, requests: Array<{ lat?: number; lng?: number; pickup_lat?: number; pickup_lng?: number }>): number
export function resizeZone(zone: TigerHeatZone, radius: number, bonusCents: number): TigerHeatZone
export function evaluateTigerHeat(input?: {
  at?: Date
  requests?: Array<{ lat?: number; lng?: number }>
  activation?: TigerHeatActivation
}): {
  at: string
  activation: TigerHeatActivation
  zones: TigerHeatZone[]
  payableZones: TigerHeatZone[]
  previewZones: TigerHeatZone[]
}
export function zoneContains(zone: { lat: number; lng: number; radius: number }, lat: number, lng: number): boolean
export function bestPayableZone(lat: number, lng: number, zones: TigerHeatZone[]): TigerHeatZone | null
export function heatWindowActivation(windowId: string): TigerHeatActivation
export function tigerHeatAnchor(windowId: string, now?: Date): Date
export function normalizeTigerHeatMap(body: unknown): {
  label: string
  windowId: string
  activation: string
  zones: TigerHeatZone[]
  deactivated: unknown[]
  solvency: unknown
  durationPolicy: unknown
  error: string | null
}
