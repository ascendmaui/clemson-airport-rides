/**
 * Standardized Lost & Found copy, status labels, actions, and instruction text across mobile & web.
 */

export const LOST_FOUND_HEADINGS = Object.freeze({
  TITLE: 'Lost & found',
  REPORT_ITEM: 'Report an item',
  DESCRIBE_TITLE: 'What was left behind?',
  MATCH_RIDE_TITLE: 'Which ride was it?',
  SUBTITLE:
    'Report something left in the vehicle after a ride. We show first names only, and we leave exact addresses off this screen.',
  COMPOSE_SUBTITLE:
    'Describe it, match the ride, then we notify the other person. First names only.',
  PRIVACY_NOTICE:
    'First names only are shown to protect privacy, and exact coordinates are omitted.',
})

export const LOST_FOUND_EMPTY_STATE = Object.freeze({
  TITLE: 'No reports yet',
  BODY: 'After a completed ride, describe the item and we’ll notify the other person.',
})

export const LOST_FOUND_ACTIONS = Object.freeze({
  REPORT_ITEM: 'Report an item',
  PICK_FROM_HISTORY: 'Pick a ride from history →',
  NEXT_PICK_RIDE: 'Next: pick the ride →',
  SEND_REPORT: 'Notify the driver',
  CONFIRM_FOUND: 'I found this item',
  CONFIRM_NOT_FOUND: 'Not found in vehicle',
  MARK_RETURNED: 'Mark as returned',
  CLOSE_REPORT: 'Close report',
  SEND_MESSAGE: 'Send message',
  BACK_TO_LOG: 'Back to all reports',
})

export const LOST_FOUND_ERRORS = Object.freeze({
  MISSING_DESCRIPTION: 'Enter a description of the item left behind.',
  SELECT_COMPLETED_RIDE: 'Pick a completed ride that has a driver.',
  IMMUTABLE_REPORT:
    'The item description and ride cannot be changed after you send the report.',
  NOT_PARTY:
    'You can only open lost-and-found reports for your own completed rides.',
  ONLY_COUNTERPART_CAN_CONFIRM:
    'Only the other person on this ride can confirm whether it was found.',
})

export const LOST_FOUND_STATUS_DETAILS = Object.freeze({
  open: {
    label: 'Open',
    hint: 'Waiting for counterpart response',
    tone: 'orange',
  },
  claimed: {
    label: 'Claimed',
    hint: 'Item located, coordinate return',
    tone: 'purple',
  },
  returned: {
    label: 'Returned',
    hint: 'Item successfully returned',
    tone: 'success',
  },
  closed: {
    label: 'Closed',
    hint: 'Report closed',
    tone: 'muted',
  },
})

/**
 * Returns formatted status metadata.
 * @param {string} [status]
 * @returns {{ label: string, hint: string, tone: string }}
 */
export function formatLostFoundStatus(status) {
  const norm = String(status || '').toLowerCase().trim()
  if (norm in LOST_FOUND_STATUS_DETAILS) {
    return LOST_FOUND_STATUS_DETAILS[norm]
  }
  return {
    label: norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : 'Open',
    hint: '',
    tone: 'muted',
  }
}

/**
 * Formats report resolution label.
 * @param {string|null} [resolution]
 * @returns {string}
 */
export function formatLostFoundResolution(resolution) {
  const norm = String(resolution || '').toLowerCase().trim()
  if (norm === 'found') return 'Found'
  if (norm === 'not_found') return 'Not found'
  return ''
}

/**
 * Summarizes item description safely with length limit.
 * @param {string|null} [desc]
 * @param {number} [maxLength]
 * @returns {string}
 */
export function formatItemSummary(desc, maxLength = 60) {
  const clean = String(desc || '').trim()
  if (!clean) return 'Unspecified item'
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 1).trim()}…`
}
