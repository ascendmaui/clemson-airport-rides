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
export function etaLineFor(
  status: string | null | undefined,
  from: LatLng | null | undefined,
  places: Parameters<typeof etaTargetForStatus>[1],
): string | null
