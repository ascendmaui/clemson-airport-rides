export type LiveStep = { id: string; label: string }

export type RiderLiveCopy = {
  kicker: string
  title: string
  body: string
}

export type RiderLiveView = RiderLiveCopy & {
  steps: LiveStep[]
  stepIndex: number
}

export type LatLng = { lat: number; lng: number }

export type EtaTarget = { point: LatLng | null; noun: string | null }

export type StraightLineEta = {
  etaMin: number | null
  distanceMi: number | null
  label: string | null
}

export const DRIVER_TRACK_STEPS: LiveStep[]
export const RIDER_TRACK_STATUSES: string[]
export const STILL_SEARCHING_MS: number
export const STILL_SEARCHING_COPY: string
export const SEARCH_PREVIEW_COPY: string
export const SEARCH_APPROX_WAIT_NOTE: string
export const STRAIGHT_LINE_WAIT: string

export function showSearchTheater(status: string | null | undefined): boolean
export function etaHoldLine(status: string | null | undefined, etaLine: string | null | undefined): string | null
export function checkoutSuccessHash(input?: { tripId?: string | null; scheduled?: boolean }): string

export function riderLiveSteps(status: string | null | undefined): LiveStep[]
export function riderLiveStepIndex(status: string | null | undefined): number
export function riderLiveCopy(
  status: string | null | undefined,
  options?: { preferred?: boolean },
): RiderLiveCopy
export function riderLiveView(
  status: string | null | undefined,
  options?: { preferred?: boolean; waitingMs?: number },
): RiderLiveView
export function etaTargetForStatus(
  status: string | null | undefined,
  places: {
    pickupLat?: number | null
    pickupLng?: number | null
    dropoffLat?: number | null
    dropoffLng?: number | null
    pickup_lat?: number | null
    pickup_lng?: number | null
    dropoff_lat?: number | null
    dropoff_lng?: number | null
  } | null | undefined,
): EtaTarget
export function straightLineEta(from: LatLng | null | undefined, to: LatLng | null | undefined): StraightLineEta
export function decodeRoutePolyline(encoded: string | null | undefined): LatLng[]
export function mapRouteCoordinates(encoded: string | null | undefined): { latitude: number; longitude: number }[]
export function roadEtaLine(durationS: number | null | undefined, noun: string | null | undefined): string | null
export function etaLineFor(
  status: string | null | undefined,
  from: LatLng | null | undefined,
  places: Parameters<typeof etaTargetForStatus>[1],
): string | null
export function activeTripRouteLine(
  trip: unknown,
  driver?: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null,
): number[][]
export function searchingRouteLine(trip: unknown): number[][]
export function searchingEtaLine(trip: unknown): string | null
export function searchingApproxWaitLine(trip: unknown): string | null
export function searchingRidePreview(trip: unknown): {
  route: number[][]
  eta: string | null
  wait: string | null
}

export type LiveStopKind = 'pickup' | 'dropoff' | 'stop'

export type LiveStopPin = {
  id: string
  order: number
  lat: number
  lng: number
  label: string
  title: string
  kind: LiveStopKind
  approximate: boolean
}

export function approxPublicCoord(value: unknown): number | null
export function carpoolPublicPinsApproximate(source: unknown): boolean
export function orderedLiveStops(
  source: unknown,
  options?: { approximate?: boolean },
): LiveStopPin[]
