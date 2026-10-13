export const SWIPE_CONFIRM_THRESHOLD: number
export const SWIPE_ACTIVE_OFFSET_X: number
export const SWIPE_FAIL_OFFSET_Y: number
export function swipeTravel(trackWidth: number, knobWidth: number): number
export function swipeOffset(dx: number, trackWidth: number, knobWidth: number): number
export function swipeProgress(dx: number, trackWidth: number, knobWidth: number): number
export function swipeConfirms(dx: number, trackWidth: number, knobWidth: number, threshold?: number): boolean

export type SwipeReleaseAction = 'accept' | 'reset'
export type SwipeCue = 'threshold' | 'success'

export function settleSwipe(input?: {
  dx?: number
  trackWidth?: number
  knobWidth?: number
  disabled?: boolean
  accepted?: boolean
  onAccept?: () => void
}): { action: SwipeReleaseAction; accepted: boolean }

export type SwipeController = {
  begin: () => void
  move: (dx: number) => { offset: number; crossed: boolean }
  release: (dx: number) => { action: SwipeReleaseAction; offset: number }
  cancel: () => void
}

export function createSwipeController(input?: {
  knobWidth?: number
  getTrackWidth?: () => number
  isDisabled?: () => boolean
  onAccept?: () => void
  onCue?: (cue: SwipeCue) => void
}): SwipeController
export function riderConfirmCopy(input?: { firstName?: string | null; photoUrl?: string | null }): {
  title: string
  body: string
  swipeLabel: string
  a11yAction: string
}
