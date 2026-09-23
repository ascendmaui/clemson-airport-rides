/**
 * PARTIAL quick replies — exact caller phrases only.
 * Do not add, reword, translate, or remove items until the complete list arrives.
 * Rider and driver share this same set. Do not fork a second chip list by role.
 */
export const RIDE_CHAT_QUICK_REPLIES = Object.freeze([
  'Just got your request',
  "I'm on the way",
  "I'm almost there",
  "I'm here",
  "I'm here, and I'm waiting",
])

export const TRIP_MESSAGE_MAX_LENGTH = 500
export const POST_RIDE_HISTORY_MS = 24 * 60 * 60 * 1000
export const ACTIVE_MESSAGE_LIMIT = 200
export const POST_RIDE_MESSAGE_LIMIT = 40

const ACTIVE_STATUSES = new Set(['accepted', 'arriving', 'in_progress'])

/**
 * @param {string} phrase
 * @returns {string | null} the canonical phrase, or null when it is not in the partial list
 */
export function canonicalQuickReply(phrase) {
  if (typeof phrase !== 'string') return null
  return RIDE_CHAT_QUICK_REPLIES.find((item) => item === phrase) ?? null
}

/**
 * @param {unknown} body
 * @returns {string}
 */
export function normalizeMessageBody(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) {
    throw new Error('Message is empty')
  }
  if (text.length > TRIP_MESSAGE_MAX_LENGTH) {
    throw new Error('Message is too long')
  }
  return text
}

/**
 * Composer is open only while the trip is accepted, arriving, or in progress.
 * After completion or cancel, last-N history stays readable for 24 hours, then the thread closes.
 * @param {{ status?: string, completed_at?: string | null, canceled_at?: string | null } | null | undefined} trip
 * @param {number} [now]
 * @returns {'compose' | 'readonly' | 'closed'}
 */
export function rideChatMode(trip, now = Date.now()) {
  if (!trip || typeof trip !== 'object') return 'closed'
  const status = trip.status
  if (ACTIVE_STATUSES.has(status)) return 'compose'
  if (status === 'completed' || status === 'canceled') {
    const preferred = status === 'completed' ? trip.completed_at : trip.canceled_at
    const endedRaw = preferred || trip.completed_at || trip.canceled_at
    if (!endedRaw) return 'readonly'
    const ended = Date.parse(endedRaw)
    if (Number.isNaN(ended)) return 'readonly'
    if (now - ended <= POST_RIDE_HISTORY_MS) return 'readonly'
    return 'closed'
  }
  return 'closed'
}

/**
 * @param {'compose' | 'readonly' | 'closed'} mode
 */
export function messageLimitForMode(mode) {
  switch (mode) {
    case 'compose':
      return ACTIVE_MESSAGE_LIMIT
    case 'readonly':
      return POST_RIDE_MESSAGE_LIMIT
    case 'closed':
      return 0
    default: {
      const unexpected = mode
      throw new Error(`Unexpected ride chat mode: ${unexpected}`)
    }
  }
}

/**
 * @param {'compose' | 'readonly' | 'closed'} mode
 * @returns {string | null}
 */
export function rideChatBanner(mode) {
  switch (mode) {
    case 'compose':
      return null
    case 'readonly':
      return 'This ride has ended. Recent messages are read-only for 24 hours.'
    case 'closed':
      return 'This ride chat is closed.'
    default: {
      const unexpected = mode
      throw new Error(`Unexpected ride chat mode: ${unexpected}`)
    }
  }
}
