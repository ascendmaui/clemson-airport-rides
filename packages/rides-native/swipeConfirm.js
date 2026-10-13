/**
 * Swipe-to-confirm math for the driver "Start trip" / accept control. No React here so it is testable.
 * The knob travels from 0 to (track - knob). Release past the threshold confirms; anything less snaps back.
 *
 * The pan claims a horizontal drag once it moves SWIPE_ACTIVE_OFFSET_X to the right, and gives up
 * to a parent scroll if the finger moves SWIPE_FAIL_OFFSET_Y vertically first.
 */
export const SWIPE_CONFIRM_THRESHOLD = 0.85
export const SWIPE_ACTIVE_OFFSET_X = 8
export const SWIPE_FAIL_OFFSET_Y = 14

export function swipeTravel(trackWidth, knobWidth) {
  const track = Number(trackWidth) || 0
  const knob = Number(knobWidth) || 0
  return Math.max(0, track - knob)
}

/** Clamped knob offset for a horizontal drag. */
export function swipeOffset(dx, trackWidth, knobWidth) {
  const travel = swipeTravel(trackWidth, knobWidth)
  const x = Number(dx) || 0
  return Math.min(travel, Math.max(0, x))
}

export function swipeProgress(dx, trackWidth, knobWidth) {
  const travel = swipeTravel(trackWidth, knobWidth)
  if (travel <= 0) return 0
  return swipeOffset(dx, trackWidth, knobWidth) / travel
}

export function swipeConfirms(dx, trackWidth, knobWidth, threshold = SWIPE_CONFIRM_THRESHOLD) {
  return swipeTravel(trackWidth, knobWidth) > 0 && swipeProgress(dx, trackWidth, knobWidth) >= threshold
}

/**
 * Release decision. Past the threshold calls onAccept and returns 'accept'.
 * Below the threshold, or when this gesture already accepted or the control is disabled,
 * returns 'reset' and does not call onAccept. Passing the previous `accepted` flag
 * is what keeps a second release in the same gesture from firing the mutation again.
 */
export function settleSwipe({
  dx = 0,
  trackWidth = 0,
  knobWidth = 0,
  disabled = false,
  accepted = false,
  onAccept,
} = {}) {
  if (!disabled && !accepted && swipeConfirms(dx, trackWidth, knobWidth)) {
    if (typeof onAccept === 'function') onAccept()
    return { action: 'accept', accepted: true }
  }
  return { action: 'reset', accepted: Boolean(accepted) }
}

/**
 * Gesture session the swipe control drives. `move` reports the clamped thumb
 * and a rising-edge `crossed` so the threshold haptic fires once per crossing.
 * `release` calls onAccept once per gesture; `begin` starts a new gesture.
 */
export function createSwipeController({
  knobWidth,
  getTrackWidth,
  isDisabled = () => false,
  onAccept,
  onCue = () => {},
} = {}) {
  let accepted = false
  let armed = false
  const width = () => Number(getTrackWidth?.()) || 0

  return {
    begin() {
      accepted = false
      armed = false
    },
    move(dx) {
      const trackWidth = width()
      const offset = swipeOffset(dx, trackWidth, knobWidth)
      const nextArmed = swipeConfirms(dx, trackWidth, knobWidth)
      const crossed = nextArmed && !armed
      armed = nextArmed
      if (crossed) onCue('threshold')
      return { offset, crossed }
    },
    release(dx) {
      const trackWidth = width()
      const travel = swipeTravel(trackWidth, knobWidth)
      const decision = settleSwipe({
        dx,
        trackWidth,
        knobWidth,
        disabled: Boolean(isDisabled()),
        accepted,
        onAccept: () => {
          accepted = true
          onCue('success')
          onAccept?.()
        },
      })
      if (decision.action === 'accept') return { action: 'accept', offset: travel }
      armed = false
      return { action: 'reset', offset: accepted ? travel : 0 }
    },
    cancel() {
      armed = false
    },
  }
}

/** Rider check shown before Start trip: first name + photo. */
export function riderConfirmCopy({ firstName, photoUrl } = {}) {
  const name = String(firstName || '').trim().split(/\s+/)[0] || 'your rider'
  return {
    title: `Is this ${name}?`,
    body: photoUrl
      ? `Match the face and ask for their name before they get in. Swipe to start once ${name} is in the car.`
      : `Ask for their name before they get in. Swipe to start once ${name} is in the car.`,
    swipeLabel: 'Swipe to start trip',
    a11yAction: `Start trip with ${name}`,
  }
}
