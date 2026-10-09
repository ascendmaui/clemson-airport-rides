export const SWIPE_CONFIRM_THRESHOLD: number
export function swipeTravel(trackWidth: number, knobWidth: number): number
export function swipeOffset(dx: number, trackWidth: number, knobWidth: number): number
export function swipeProgress(dx: number, trackWidth: number, knobWidth: number): number
export function swipeConfirms(dx: number, trackWidth: number, knobWidth: number, threshold?: number): boolean
export function riderConfirmCopy(input?: { firstName?: string | null; photoUrl?: string | null }): {
  title: string
  body: string
  swipeLabel: string
  a11yAction: string
}
