export const LIVE_LOCATION_STATUSES: readonly ['accepted', 'arriving', 'arrived', 'in_progress']

export function isLiveLocationStatus(status: unknown): boolean

export function headingOrNull(value: unknown): number | null

export function speedOrNull(value: unknown): number | null

export type LiveFix = {
  lat: number
  lng: number
  heading: number | null
  speed: number | null
  updatedAt: string | null
}

export type LiveFixRow = {
  lat?: unknown
  lng?: unknown
  heading?: unknown
  speed?: unknown
  updated_at?: string | null
  location_updated_at?: string | null
} | null | undefined

export function coordsFromRow(row: LiveFixRow): LiveFix | null

export function liveFixFromReads(input?: {
  tripRow?: LiveFixRow
  tripError?: { message?: string } | null
  statusRow?: LiveFixRow
  statusError?: { message?: string } | null
}): { fix: LiveFix | null; error: { message?: string } | null }

export function missingTripLocationTable(error: { message?: string } | string | null | undefined): boolean
