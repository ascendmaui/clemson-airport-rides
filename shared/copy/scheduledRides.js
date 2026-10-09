/**
 * Plain-language copy for scheduled rides with a backup driver.
 * A How it works screen can import `scheduledRidesGuide`.
 * Short lines for each decision live on `scheduledRidesTopic`.
 */
import {
  DRIVER_AND_BACKUP_LABEL,
  LOOKING_FOR_BACKUP_LABEL,
  RIDER_ENROUTE_COPY,
} from '../backupDriverQueue.js'

export const SCHEDULED_RIDES_EXPLAINER_KEY = 'clemson-scheduled-rides-explainer'

export const BOOKING_HELPER = 'Add a second driver in line for $10 or $15. That amount is a hold on your card with the fare.'

export const BOOKING_STEPS = Object.freeze([
  'Turn this on if you want a second driver ready.',
  'Choose $10 or $15.',
  'That amount is a hold on your card with the fare. You are charged when the trip ends.',
  'The second driver gets that money for being ready.',
  'If they never have to drive, they still get it when they stayed available.',
])

export const LOOKING_HELPER = `${LOOKING_FOR_BACKUP_LABEL} means the first driver is set. We still need a second driver in line.`

export const LOOKING_STEPS = Object.freeze([
  'The first driver has accepted.',
  'The second seat is still open.',
  'That second driver is paid $10 or $15 for being ready.',
  'If the first driver does not confirm, the second driver takes the trip.',
])

export const CONFIRM_HELPER = 'You have 5 minutes to tap Confirm trip. That means you will go to pickup and finish the ride.'

export const CONFIRM_STEPS = Object.freeze([
  'A Confirm trip button appears before pickup.',
  'You have 5 minutes to tap it.',
  'Tapping it means you will go to pickup at the right time and finish the ride.',
  'If you do not tap it, the second driver in line takes the trip.',
  'If there is no second driver, the ride opens to every driver.',
])

export const LEAVE_HELPER = 'After you confirm, a countdown shows Leave now. When it hits zero, the map starts and your location shares as an active trip.'

export const LEAVE_STEPS = Object.freeze([
  'Leave now is the pickup time minus the drive.',
  'The countdown runs after you tap Confirm trip.',
  'When it hits zero, the route to pickup starts on the map.',
  'You can open the same route in Apple Maps or Google Maps.',
  'Your location starts sharing as an active trip. That counts as started driving.',
  `The rider sees: ${RIDER_ENROUTE_COPY}`,
])

export const MAPS_HANDOFF_HELPER = 'Your route to pickup is on the map. You can also open it in Apple Maps or Google Maps.'

export const SWITCH_HELPER = 'The drivers swap places. You can switch once. The first driver gets your $10 or $15 as a switch fee. A switch never counts as a strike.'

export const SWITCH_STEPS = Object.freeze([
  'You can switch once, before your driver starts toward you.',
  'The two drivers swap places.',
  'The second driver becomes your driver.',
  'The first driver gets your $10 or $15 as a switch fee.',
  'Your new driver gets the fare and any boost.',
  'A switch never counts as a strike.',
])

export const CANCEL_HELPER = 'If you cancel, the first driver gets the $10 or $15. The second driver gets nothing. Any boost is given back. The rest of the hold on your card is released.'

export const CANCEL_STEPS = Object.freeze([
  'You can cancel before pickup.',
  'The first driver gets the $10 or $15.',
  'The second driver gets nothing.',
  'Any boost is given back.',
  'The rest of the hold on your card is released.',
])

export const OFFER_HELPER = 'This ride wants a second driver in line. The +$10 or +$15 is yours for being ready.'

export const OFFER_STEPS = Object.freeze([
  `${LOOKING_FOR_BACKUP_LABEL} means the first driver is set and this seat is still open.`,
  'You are the second driver in line.',
  'The +$10 or +$15 is what you get for being ready.',
  'You still get it if you are not needed, as long as you stay available.',
  'If the first driver does not confirm, you become the driver.',
  'Then you have 5 minutes to tap Confirm trip.',
])

export const RIDER_OVERVIEW = Object.freeze([
  'You can book a second driver in line for $10 or $15.',
  'That amount is a hold on your card with the fare.',
  `${LOOKING_FOR_BACKUP_LABEL} means we still need that second driver.`,
  `${DRIVER_AND_BACKUP_LABEL} means both drivers are set.`,
  'Your driver has 5 minutes to tap Confirm trip before pickup.',
  'After they confirm, a countdown tells them when to leave.',
  'When it hits zero, they start toward you and you get a notice to sit tight.',
  'You can switch once. The drivers swap places. The first driver gets the $10 or $15 as a switch fee. A switch never counts as a strike.',
  'If you cancel, the first driver gets the fee, the second driver gets nothing, any boost is given back, and the rest of the hold on your card is released.',
])

export const DRIVER_OVERVIEW = Object.freeze([
  'A rider can add a second driver in line for $10 or $15.',
  `${LOOKING_FOR_BACKUP_LABEL} means the first seat is taken and the second seat is open.`,
  'The +$10 or +$15 goes to the second driver for being ready.',
  'You still get it if you are not needed, as long as you stay available.',
  'Before pickup you have 5 minutes to tap Confirm trip.',
  'That means you will go to pickup and finish the ride.',
  'After you confirm, a countdown shows Leave now. That time is pickup minus the drive.',
  'When it hits zero, the map starts, you can open Apple Maps or Google Maps, and your location shares as an active trip.',
  'If the rider switches, you swap places. The first driver gets the $10 or $15 as a switch fee. A switch never counts as a strike.',
  'If the rider cancels, the first driver gets the fee and the second driver gets nothing.',
])

export function leaveNowStartedLine() {
  return 'Leave now. The route to pickup is on the map. Your location is sharing as an active trip. The rider has been told you are on the way.'
}

export function scheduledRidesExplainerKey(role) {
  return `${SCHEDULED_RIDES_EXPLAINER_KEY}.${role === 'driver' ? 'driver' : 'rider'}`
}

/**
 * One decision point. Import the helper under the control, and the steps in the info sheet.
 * @param {'booking' | 'looking' | 'confirm' | 'leave' | 'switch' | 'cancel' | 'offer'} topic
 */
export function scheduledRidesTopic(topic) {
  switch (topic) {
    case 'booking':
      return { title: 'Backup driver', helper: BOOKING_HELPER, steps: BOOKING_STEPS, infoLabel: 'How a backup driver works' }
    case 'looking':
      return { title: 'Looking for a second driver', helper: LOOKING_HELPER, steps: LOOKING_STEPS, infoLabel: 'What looking for a backup driver means' }
    case 'confirm':
      return { title: 'Confirm trip', helper: CONFIRM_HELPER, steps: CONFIRM_STEPS, infoLabel: 'How Confirm trip works' }
    case 'leave':
      return { title: 'Leave now', helper: LEAVE_HELPER, steps: LEAVE_STEPS, infoLabel: 'How Leave now works' }
    case 'switch':
      return { title: 'Switch drivers', helper: SWITCH_HELPER, steps: SWITCH_STEPS, infoLabel: 'How switching drivers works' }
    case 'cancel':
      return { title: 'Cancel this ride', helper: CANCEL_HELPER, steps: CANCEL_STEPS, infoLabel: 'How canceling works' }
    case 'offer':
      return { title: 'Backup seat', helper: OFFER_HELPER, steps: OFFER_STEPS, infoLabel: 'How the backup seat works' }
    default: {
      const unexpected = topic
      throw new Error(`Unexpected scheduled rides topic: ${unexpected}`)
    }
  }
}

function section(topic) {
  const copy = scheduledRidesTopic(topic)
  return { id: topic, title: copy.title, helper: copy.helper, steps: copy.steps }
}

/**
 * Full guide for one role. Import this on a How it works screen.
 * @param {'rider' | 'driver'} role
 */
export function scheduledRidesGuide(role) {
  switch (role) {
    case 'rider':
      return {
        title: 'How scheduled rides work',
        summary: RIDER_OVERVIEW,
        sections: ['booking', 'looking', 'leave', 'switch', 'cancel'].map(section),
        infoLabel: 'How scheduled rides work',
      }
    case 'driver':
      return {
        title: 'How scheduled rides work',
        summary: DRIVER_OVERVIEW,
        sections: ['offer', 'confirm', 'leave', 'switch', 'cancel'].map(section),
        infoLabel: 'How scheduled rides work',
      }
    default: {
      const unexpected = role
      throw new Error(`Unexpected scheduled rides role: ${unexpected}`)
    }
  }
}
