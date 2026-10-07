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

/**
 * Single lost-item window. A report can be opened this long after completion,
 * and the thread stays writable this long after it opens (or until resolved).
 * Keep in sync with public.lost_item_thread_window() in
 * supabase/migrations/20261007220000_trip_lost_item_messaging.sql.
 */
export const LOST_ITEM_THREAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const LOST_ITEM_DESCRIPTION_MAX = 80

const LOST_ITEM_THREAD_WINDOW_DAYS = LOST_ITEM_THREAD_WINDOW_MS / (24 * 60 * 60 * 1000)
const ACTIVE_STATUSES = new Set(['accepted', 'arriving', 'arrived', 'in_progress'])

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
 * @param {unknown} description
 * @returns {string | null}
 */
export function normalizeLostItemDescription(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length > LOST_ITEM_DESCRIPTION_MAX) {
    throw new Error('Keep the lost-item note under 80 characters')
  }
  return text
}

/**
 * @param {{ rider_id?: string | null, driver_id?: string | null, riderId?: string | null, driverId?: string | null } | null | undefined} trip
 * @param {string | null | undefined} userId
 * @returns {'rider' | 'driver' | null}
 */
export function tripPartyRole(trip, userId) {
  if (!trip || !userId) return null
  const riderId = trip.rider_id || trip.riderId || null
  const driverId = trip.driver_id || trip.driverId || null
  if (userId === riderId) return 'rider'
  if (userId === driverId) return 'driver'
  return null
}

/**
 * @param {{ status?: string, opened_at?: string | null, openedAt?: string | null } | null | undefined} report
 * @param {number} [now]
 * @returns {'none' | 'open' | 'resolved' | 'expired'}
 */
export function lostItemReportState(report, now = Date.now()) {
  if (!report || typeof report !== 'object') return 'none'
  if (report.status === 'resolved') return 'resolved'
  if (report.status !== 'open') return 'none'
  const opened = Date.parse(report.opened_at || report.openedAt || '')
  if (Number.isNaN(opened)) return 'expired'
  if (now - opened <= LOST_ITEM_THREAD_WINDOW_MS) return 'open'
  return 'expired'
}

/**
 * Writable while the driver is assigned (accepted, arriving, arrived, in progress),
 * or while a lost-item report on a completed trip is still inside the window.
 * Completed and canceled trips are closed to new messages otherwise.
 * @param {{ status?: string } | null | undefined} trip
 * @param {number} [now]
 * @param {{ status?: string, opened_at?: string | null, openedAt?: string | null } | null} [report]
 */
export function canSendTripMessage(trip, now = Date.now(), report = null) {
  if (!trip || typeof trip !== 'object') return false
  if (ACTIVE_STATUSES.has(trip.status)) return true
  if (trip.status !== 'completed') return false
  return lostItemReportState(report, now) === 'open'
}

/**
 * Either party may open a report on a completed trip inside the same window.
 * @param {{ status?: string, completed_at?: string | null, completedAt?: string | null } | null | undefined} trip
 * @param {number} [now]
 * @param {'rider' | 'driver' | null} [role]
 */
export function canOpenLostItemReport(trip, now = Date.now(), role = null) {
  if (role !== 'rider' && role !== 'driver') return false
  if (!trip || trip.status !== 'completed') return false
  const ended = Date.parse(trip.completed_at || trip.completedAt || '')
  if (Number.isNaN(ended)) return false
  if (now < ended) return false
  return now - ended <= LOST_ITEM_THREAD_WINDOW_MS
}

/**
 * Composer is open before the ride (accepted, arriving, arrived), during it,
 * and on an open lost-item thread. After completion or cancel the thread is
 * read-only (history for 24 hours, then hidden) unless that lost-item thread
 * is open. A resolved or expired lost-item thread stays readable.
 * @param {{ status?: string, completed_at?: string | null, canceled_at?: string | null } | null | undefined} trip
 * @param {number} [now]
 * @param {{ status?: string, opened_at?: string | null, openedAt?: string | null } | null} [report]
 * @returns {'compose' | 'readonly' | 'closed'}
 */
export function rideChatMode(trip, now = Date.now(), report = null) {
  if (!trip || typeof trip !== 'object') return 'closed'
  if (canSendTripMessage(trip, now, report)) return 'compose'
  const lost = lostItemReportState(report, now)
  if (lost === 'resolved' || lost === 'expired') return 'readonly'
  const status = trip.status
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
 * @param {{ status?: string, opened_at?: string | null, openedAt?: string | null } | null} [report]
 * @param {number} [now]
 * @returns {string | null}
 */
export function rideChatBanner(mode, report = null, now = Date.now()) {
  const lost = lostItemReportState(report, now)
  if (mode === 'compose' && lost === 'open') {
    return `Lost item thread. You can message for ${LOST_ITEM_THREAD_WINDOW_DAYS} days, or until either of you marks it resolved.`
  }
  if (mode === 'readonly' && lost === 'resolved') {
    return 'This lost-item thread is resolved. Messages are read-only.'
  }
  if (mode === 'readonly' && lost === 'expired') {
    return 'This lost-item thread has closed. Messages are read-only.'
  }
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
