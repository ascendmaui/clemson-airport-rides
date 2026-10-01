/**
 * Standardized Carpool & FriendRide lobby copy, action verbs, and status taxonomy.
 * Preserves math in carpoolEngine.js and friendSplitPreview.js while providing
 * unified UI copy across mobile and web platforms.
 */

export const LOBBY_ACTIONS = Object.freeze({
  CREATE_LOBBY: 'Create lobby',
  JOIN_LOBBY: 'Join lobby',
  INVITE_FRIENDS: 'Invite friends',
  COPY_INVITE: 'Copy lobby link',
  LINK_COPIED: 'Lobby link copied!',
  UPDATE_STOPS: 'Update stops',
  ADD_STOPS: 'Add your stops',
  SAVE_STOPS: 'Save stops',
  OPTIMIZE_ROUTE: 'Optimize route & fares',
  CALCULATING_FARES: 'Calculating fares…',
  LOCK_SEATS: 'Lock seats',
  CONFIRM_CHARGES: 'Confirm & charge',
  SETTLE_FARES: 'Settle fares',
  LEAVE_LOBBY: 'Leave lobby',
  CANCEL_LOBBY: 'Cancel lobby',
})

export const LOBBY_STATUSES = Object.freeze({
  open: {
    label: 'Open',
    hint: 'Inviting riders and adding stops',
    tone: 'info',
  },
  locked: {
    label: 'Seats Locked',
    hint: 'Stops finalized, calculating route',
    tone: 'warning',
  },
  confirmed: {
    label: 'Confirmed',
    hint: 'All riders confirmed fares',
    tone: 'success',
  },
  booked: {
    label: 'Booked',
    hint: 'Driver assigned and dispatched',
    tone: 'brand',
  },
  canceled: {
    label: 'Canceled',
    hint: 'Lobby canceled',
    tone: 'muted',
  },
})

export const PARTICIPANT_ROLES = Object.freeze({
  ORGANIZER: 'Organizer',
  RIDER: 'Rider',
})

export const PARTICIPANT_STATUSES = Object.freeze({
  joined: {
    label: 'Joined',
    hint: 'Stops added',
  },
  ready: {
    label: 'Ready',
    hint: 'Fare preview reviewed',
  },
  confirmed: {
    label: 'Confirmed',
    hint: 'Payment authorized',
  },
  pending: {
    label: 'Invited',
    hint: 'Awaiting response',
  },
  declined: {
    label: 'Declined',
    hint: 'Declined invitation',
  },
})

export const SPLIT_MODES = Object.freeze({
  even: {
    id: 'even',
    label: 'Even split',
    description: 'Split total fare equally among all riders',
  },
  by_distance: {
    id: 'by_distance',
    label: 'By distance',
    description: 'Split fare proportionally based on individual ride distance',
  },
})

export const LOBBY_BANNER_COPY = Object.freeze({
  BEFORE_CONFIRM: 'BEFORE YOU CONFIRM',
  SPLIT_PREVIEW_TITLE: 'Fare split preview',
  SHARE_SAVINGS_EXPLAINER:
    'Struck prices are this route alone. Confirm charges individual shares off-session or with Apple Pay.',
  FIRST_RIDE_FREE_BADGE: 'First ride free',
  CLEMSON_STUDENT_BADGE: 'Clemson student',
  FIRST_RIDE_ELIGIBLE_NOTE: 'First ride free with Clemson student email',
  EMPTY_LOBBY_NOTE:
    'Share your lobby link with friends or classmates heading the same direction.',
})

/**
 * Resolves lobby status details.
 * @param {string} [status]
 * @returns {{ label: string, hint: string, tone: string }}
 */
export function formatLobbyStatus(status) {
  const norm = String(status || '').toLowerCase().trim()
  if (norm in LOBBY_STATUSES) {
    return LOBBY_STATUSES[norm]
  }
  return {
    label: norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : 'Open',
    hint: 'Lobby in progress',
    tone: 'info',
  }
}

/**
 * Returns formatted participant role string.
 * @param {string} [role]
 * @param {boolean} [isOrganizer]
 * @returns {string}
 */
export function formatParticipantRole(role, isOrganizer = false) {
  if (isOrganizer || String(role).toLowerCase() === 'organizer') {
    return PARTICIPANT_ROLES.ORGANIZER
  }
  return PARTICIPANT_ROLES.RIDER
}

/**
 * Formats participant status badge.
 * @param {string} [status]
 * @returns {{ label: string, hint: string }}
 */
export function formatParticipantStatus(status) {
  const norm = String(status || '').toLowerCase().trim()
  if (norm in PARTICIPANT_STATUSES) {
    return PARTICIPANT_STATUSES[norm]
  }
  return {
    label: norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : 'Joined',
    hint: '',
  }
}

/**
 * Formats split mode display label.
 * @param {string} [mode]
 * @returns {string}
 */
export function formatSplitMode(mode) {
  const norm = String(mode || '').toLowerCase().trim()
  if (norm === 'by_distance') return SPLIT_MODES.by_distance.label
  return SPLIT_MODES.even.label
}

/**
 * Checks if lobby is at or above capacity.
 * @param {number} current
 * @param {number} max
 * @returns {boolean}
 */
export function isLobbyFull(current, max) {
  const c = Math.max(0, Number(current) || 0)
  const m = Math.max(1, Number(max) || 1)
  return c >= m
}

/**
 * Formats seat capacity badge with availability count and semantic tone.
 * @param {number} current
 * @param {number} max
 * @returns {{ label: string, available: number, full: boolean, tone: 'warning' | 'accent' | 'info' }}
 */
export function formatCapacityBadge(current, max) {
  const c = Math.max(0, Number(current) || 0)
  const m = Math.max(1, Number(max) || 1)
  const available = Math.max(0, m - c)

  if (available <= 0) {
    return {
      label: 'Lobby full',
      available: 0,
      full: true,
      tone: 'warning',
    }
  }

  if (available === 1) {
    return {
      label: '1 seat left',
      available: 1,
      full: false,
      tone: 'accent',
    }
  }

  return {
    label: `${available} seats available`,
    available,
    full: false,
    tone: 'info',
  }
}

/**
 * Formats participant seat counter.
 * @param {number} current
 * @param {number} max
 * @returns {string}
 */
export function formatSeatCount(current, max) {
  const c = Math.max(0, Number(current) || 0)
  const m = Math.max(1, Number(max) || 1)
  return `${c}/${m} seats`
}

/**
 * Formats a waypoint stop label.
 * @param {'pickup' | 'dropoff'} type
 * @param {number} index
 * @returns {string}
 */
export function formatWaypointLabel(type, index = 0) {
  const label = type === 'pickup' ? 'Pickup' : 'Dropoff'
  return `Stop ${index + 1}: ${label}`
}

/**
 * Formats hop summary string.
 * @param {string} [pickupLabel]
 * @param {string} [dropoffLabel]
 * @returns {string}
 */
export function formatHopSummary(pickupLabel, dropoffLabel) {
  const p = String(pickupLabel || 'Pickup').trim()
  const d = String(dropoffLabel || 'Dropoff').trim()
  return `${p} → ${d}`
}
