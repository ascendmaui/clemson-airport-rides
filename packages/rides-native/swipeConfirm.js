/**
 * Swipe-to-confirm math for the driver "Start trip" control. No React here so it is testable.
 * The knob travels from 0 to (track - knob). Release past the threshold confirms; anything less snaps back.
 */
export const SWIPE_CONFIRM_THRESHOLD = 0.85

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
