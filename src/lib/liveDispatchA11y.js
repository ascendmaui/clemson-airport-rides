/**
 * Utilities for accessible live region dispatching, driver matching,
 * and trip progress updates for web riders and drivers.
 */

export const DISPATCH_A11Y_ROLE = 'status'
export const DISPATCH_A11Y_LIVE = 'polite'

export const DISPATCH_STATUS_TEXT = Object.freeze({
  searching: 'Looking for available drivers nearby...',
  offered: 'Dispatch offer sent to nearby drivers.',
  accepted: 'Driver matched and accepted your ride.',
  arriving: 'Driver is en route to pickup.',
  in_progress: 'Trip is in progress.',
  completed: 'Trip completed. You have arrived at your destination.',
  canceled: 'This ride has been canceled.',
})

/**
 * Returns formatted progress bar value text for assistive technology.
 * e.g. "Step 2 of 4: Driver en route"
 *
 * @param {number} activeIndex - 0-indexed current progress step
 * @param {Array<{ id: string, label: string }>} steps - Step items
 * @returns {string} Formatted accessible step description
 */
export function formatTripProgressValueText(activeIndex, steps = []) {
  if (!Array.isArray(steps) || steps.length === 0 || typeof activeIndex !== 'number' || activeIndex < 0) {
    return ''
  }
  const total = steps.length
  const currentNum = Math.min(activeIndex + 1, total)
  const stepObj = steps[activeIndex] || steps[total - 1]
  const label = stepObj?.label ? `: ${stepObj.label}` : ''
  return `Step ${currentNum} of ${total}${label}`
}

/**
 * Generates ARIA attributes for a trip progress bar indicator.
 *
 * @param {Object} options
 * @param {number} options.activeIndex - 0-indexed current step index
 * @param {Array<{ id: string, label: string }>} options.steps - Progress step definitions
 * @param {string} [options.label] - Accessible name for the progress bar
 * @returns {Object} ARIA progressbar attributes
 */
export function getProgressStepA11yProps({ activeIndex, steps = [], label = 'Trip progress' } = {}) {
  const hasSteps = Array.isArray(steps) && steps.length > 0
  const active = typeof activeIndex === 'number' && activeIndex >= 0
  return {
    role: 'progressbar',
    'aria-label': label,
    'aria-valuenow': active ? activeIndex + 1 : 0,
    'aria-valuemin': 1,
    'aria-valuemax': hasSteps ? steps.length : 1,
    'aria-valuetext': formatTripProgressValueText(activeIndex, steps),
  }
}

/**
 * Generates ARIA live region container properties for dynamic trip status.
 *
 * @param {Object} [options]
 * @param {string} [options.role='status'] - WAI-ARIA role
 * @param {string} [options.ariaLive='polite'] - Politeness level
 * @param {boolean} [options.ariaAtomic=true] - Whether to announce whole region on update
 * @returns {Object} ARIA live region attributes
 */
export function getLivePhaseRegionProps({
  role = DISPATCH_A11Y_ROLE,
  ariaLive = DISPATCH_A11Y_LIVE,
  ariaAtomic = true,
} = {}) {
  return {
    role,
    'aria-live': ariaLive,
    'aria-atomic': ariaAtomic ? 'true' : 'false',
  }
}

/**
 * Formats a concise, descriptive announcement string for live dispatch events.
 *
 * @param {Object} options
 * @param {string} [options.status] - Dispatch or ride status
 * @param {string} [options.driverName] - Name of matched driver (if known)
 * @param {string} [options.eta] - Estimated arrival or hold time
 * @param {string} [options.phaseTitle] - Current phase title
 * @param {string} [options.body] - Detailed status description
 * @returns {string} Live announcement text
 */
export function formatDispatchStatusAnnouncement({
  status,
  driverName,
  eta,
  phaseTitle,
  body,
} = {}) {
  if (!status && !phaseTitle) return 'Trip status update'

  switch (status) {
    case 'searching':
      return phaseTitle || DISPATCH_STATUS_TEXT.searching
    case 'offered':
      return phaseTitle || DISPATCH_STATUS_TEXT.offered
    case 'accepted': {
      const who = driverName ? `Driver ${driverName}` : 'A driver'
      const etaPart = eta ? ` · ETA: ${eta}` : ''
      return `${who} accepted your ride!${etaPart}`
    }
    case 'arriving': {
      const who = driverName ? driverName : 'Your driver'
      const etaPart = eta ? ` · Estimated arrival: ${eta}` : ''
      return `${who} is en route to your pickup location.${etaPart}`
    }
    case 'in_progress':
      return 'Trip is underway to your destination.'
    case 'completed':
      return 'Trip completed. Thank you for riding!'
    case 'canceled':
      return 'This ride has been canceled.'
    default: {
      const title = phaseTitle || DISPATCH_STATUS_TEXT[status] || status
      const etaPart = eta ? ` (${eta})` : ''
      const bodyPart = body ? ` - ${body}` : ''
      return `${title}${etaPart}${bodyPart}`
    }
  }
}
