export const ROAD_SNAP_METERS: number

export type LatLng = { lat: number; lng: number }

export type RoadSuffix = {
  path: LatLng[]
  distanceM: number
  totalM: number
  snapMeters: number
}

export function pathLengthMeters(points: LatLng[] | null | undefined): number
export function snapPathSuffix(
  points: LatLng[] | null | undefined,
  from: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null | undefined,
  maxMeters?: number,
): RoadSuffix | null
export function storedRoadSuffix(
  trip: unknown,
  driver: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null | undefined,
  status?: string | null,
): RoadSuffix | null
export function legNounForStatus(status: string | null | undefined): 'pickup' | 'drop-off' | null
export function directionsEtaLine(input?: {
  meters?: number | null
  seconds?: number | null
  noun?: string | null
}): string | null
export function remainingRoadLine(
  distanceM: number | null | undefined,
  totalM: number | null | undefined,
  durationS: number | null | undefined,
  noun: string | null | undefined,
): string | null
export function followEtaLine(
  status: string | null | undefined,
  from: { lat?: number | null; lng?: number | null } | null | undefined,
  places: unknown,
): string | null
export function followRouteLine(
  trip: unknown,
  driver?: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null,
): number[][]
export function followMapCoordinates(
  trip: unknown,
  driver?: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null,
): { latitude: number; longitude: number }[]
export function travelBearing(
  from: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null | undefined,
  to: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null | undefined,
): number | null
export function lerpHeading(from: number | null | undefined, to: number | null | undefined, t: number): number | null
