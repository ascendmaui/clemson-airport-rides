/**
 * Plain-language copy for canceling a matched driver before pickup.
 * A How it works screen can import `riderSwitchGuide`.
 */

export const RIDER_SWITCH_SUMMARY = Object.freeze([
  'After a driver accepts, and before they arrive, you can cancel that match.',
  'You can ask for another driver right away, pick someone else who is online, or change to Standard, Wait & Save, Extra Comfort, or Carpool.',
  'That cancel is free. A charge starts only after the driver arrives at pickup.',
  'The first 3 minutes at pickup are still free. After that, waiting is $1 a minute.',
  'If you keep the ride going with someone else, the hold on your card stays with this ride.',
  'If you cancel and do not ask for another ride, we release the hold.',
  'You are charged when the ride ends.',
])

export function riderSwitchGuide() {
  return {
    title: 'Change driver before pickup',
    summary: RIDER_SWITCH_SUMMARY,
  }
}

export function switchFeeLine() {
  return 'Free. Your driver has not arrived, so there is no cancel fee.'
}

export function arrivedBlockedLine() {
  return 'Your driver is at pickup. The first 3 minutes are free. After that, waiting is $1 a minute.'
}

export function startedBlockedLine() {
  return 'This ride has started. Canceling now uses the mid-ride charge.'
}

export function unmatchedLine() {
  return 'You can switch once a driver has accepted, and before they arrive.'
}

export function holdKeepLine() {
  return 'The hold on your card stays with this ride. You are charged when the ride ends.'
}

export function holdReleaseLine() {
  return 'We release the hold on your card. You are not charged.'
}

export function holdGrowLine() {
  return 'The hold on your card may go up to cover this fare. You are charged when the ride ends.'
}

export function holdPlaceLine() {
  return 'We place a hold for the estimated fare. You are charged when the ride ends.'
}

export function holdCreditsLine() {
  return 'Ride credits cover this trip. There is no card hold to move.'
}

export function holdLine(hold) {
  switch (hold) {
    case 'keep':
      return holdKeepLine()
    case 'release':
      return holdReleaseLine()
    case 'grow':
      return holdGrowLine()
    case 'place':
      return holdPlaceLine()
    case 'none':
      return holdCreditsLine()
    default: {
      const unknown = hold
      return unknown ? holdKeepLine() : holdKeepLine()
    }
  }
}

export function carpoolSwitchLine() {
  return 'Carpool is a seat on this ride, at the Carpool price. The card hold stays with the ride.'
}

export function openPoolLine() {
  return 'No other driver is online right now. Request another driver puts this ride in the open pool.'
}
