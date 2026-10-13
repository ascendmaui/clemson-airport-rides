export const LOCATION_PUBLISH_MIN_INTERVAL_MS: number
export const TRIP_LOCATION_HEARTBEAT_MS: number
export function createTripLocationHeartbeat(options?: {
  publish?: (fix: { lat: number; lng: number; heading?: number | null; speed?: number | null }) => Promise<unknown> | unknown
  active?: () => Promise<boolean> | boolean
  intervalMs?: number
}): {
  remember: (fix: { lat?: number; lng?: number; heading?: number | null; speed?: number | null } | null) => void
  lastFix: () => { lat: number; lng: number; heading: number | null; speed: number | null } | null
  start: () => void
  stop: () => void
  beat: () => Promise<boolean>
}
export function isActiveTripLocationStatus(status: string | null | undefined): boolean
export type TripLocation = {
  timestamp: number
  coords: { latitude: number; longitude: number }
}
export function newestTripLocation<T extends TripLocation>(locations: readonly T[] | null | undefined): T | null
export function shouldPublishTripLocation(lastPublishedAt: number | null | undefined, now?: number): boolean
