export const LOCATION_PUBLISH_MIN_INTERVAL_MS: number
export function isActiveTripLocationStatus(status: string | null | undefined): boolean
export type TripLocation = {
  timestamp: number
  coords: { latitude: number; longitude: number }
}
export function newestTripLocation<T extends TripLocation>(locations: readonly T[] | null | undefined): T | null
export function shouldPublishTripLocation(lastPublishedAt: number | null | undefined, now?: number): boolean
