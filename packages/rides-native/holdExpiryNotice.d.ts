export const HOLD_COUNTDOWN_TICK_MS: number
export const REQUEST_AGAIN_LABEL: string
export const SURFACE_TTL_CANCEL_MS: number

export type HoldExpiryMode = 'hidden' | 'countdown' | 'expired'

export type HoldExpiryPresentation = {
  mode: HoldExpiryMode
  label: string
  requestAgain: boolean
}

export function unpaidHoldCancelReason(trip: object | null | undefined): string
export function isUnpaidHoldTtlCancel(trip: object | null | undefined): boolean
export function isOpenUnpaidAirportHold(trip: object | null | undefined): boolean
export function shouldSurfaceHold(trip: object | null | undefined, now?: number): boolean
export function holdAirportCode(trip: object | null | undefined): 'GSP' | 'CLT' | null
export function holdExpiryPresentation(
  trip: object | null | undefined,
  now?: number | Date | string | null,
): HoldExpiryPresentation
