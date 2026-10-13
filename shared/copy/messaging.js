/**
 * Plain-language messaging copy for the rider and driver apps.
 * A How it works screen can import `messagingGuide`.
 * Keep the day count aligned with LOST_ITEM_THREAD_WINDOW_MS.
 */

export const MESSAGING_LOST_ITEM_DAYS = 7

export const MESSAGING_SUMMARY = Object.freeze([
  'You can message after a driver accepts the ride.',
  'You can message during the ride.',
  'Chat closes when the ride ends.',
  'The only exception is a lost item.',
])

export function chatOpenLine() {
  return 'You can message now. Chat is open after a driver accepts, and during the ride.'
}

export function chatEndedLine() {
  return 'Chat is closed. It closes when the ride ends. The only exception is a lost item.'
}

export function chatClosedLine() {
  return 'This chat is closed.'
}

export function lostItemOpenLine(days = MESSAGING_LOST_ITEM_DAYS) {
  return `This chat is open for a lost item. You can message for ${days} days, or until either of you marks it resolved.`
}

export function lostItemResolvedLine() {
  return 'This lost item is marked resolved. Chat is closed.'
}

export function lostItemExpiredLine(days = MESSAGING_LOST_ITEM_DAYS) {
  return `The ${days} days are over. Chat is closed.`
}

export function lostItemBannerLine(description) {
  const detail = typeof description === 'string' && description.trim()
    ? `: ${description.trim()}`
    : ''
  return `A lost item was reported on your ride${detail}. Open messages to arrange the return.`
}

export function lostItemBannerFollowUp(days = MESSAGING_LOST_ITEM_DAYS) {
  return `Chat stays open for ${days} days, or until either of you marks it resolved.`
}

export function lostItemToast() {
  return {
    title: 'Lost item on your ride',
    body: 'Open messages to arrange the return.',
  }
}

export function lostItemNoticeBody({ description, reporterRole, days = MESSAGING_LOST_ITEM_DAYS } = {}) {
  const who = reporterRole === 'rider' ? 'Your rider' : 'Your driver'
  const item = typeof description === 'string' && description.trim() ? ` (${description.trim()})` : ''
  return `${who} reported a lost item${item}. Open messages to arrange the return. Chat stays open for ${days} days, or until either of you marks it resolved.`
}

/**
 * Short line under the chat. Open rides get the “you can message now” line.
 * Ended rides, closed chats, and lost-item chats get the matching lock line.
 * @param {{ mode: 'compose' | 'readonly' | 'closed', lost?: 'open' | 'resolved' | 'expired' | null, days?: number }} input
 */
export function inlineChatHelper({ mode, lost = null, days = MESSAGING_LOST_ITEM_DAYS }) {
  if (mode === 'compose' && lost === 'open') return lostItemOpenLine(days)
  if (mode === 'readonly' && lost === 'resolved') return lostItemResolvedLine()
  if (mode === 'readonly' && lost === 'expired') return lostItemExpiredLine(days)
  switch (mode) {
    case 'compose':
      return chatOpenLine()
    case 'readonly':
      return chatEndedLine()
    case 'closed':
      return chatClosedLine()
    default: {
      const unexpected = mode
      throw new Error(`Unexpected ride chat mode: ${unexpected}`)
    }
  }
}

/**
 * Lock and lost-item lines only. A normal open chat returns null so older
 * callers can keep a quiet compose state.
 * @param {'compose' | 'readonly' | 'closed'} mode
 * @param {'open' | 'resolved' | 'expired' | null} [lost]
 * @param {number} [days]
 */
export function chatLockLine(mode, lost = null, days = MESSAGING_LOST_ITEM_DAYS) {
  if (mode === 'compose' && lost !== 'open') return null
  return inlineChatHelper({ mode, lost, days })
}

function driverLostItemSteps(days) {
  return [
    'Tap Report a lost item.',
    'Describe the item. A short note is enough.',
    'The rider is notified.',
    'You both can chat to arrange the return.',
    `Chat closes after ${days} days, or when either of you marks it resolved.`,
  ]
}

function riderLostItemSteps(days) {
  return [
    'You get a notice if a lost item is reported on your ride.',
    'Open the message to see what was lost.',
    'Chat with your driver to arrange the return.',
    'You can also tap I lost an item if you left something in the car.',
    `Chat closes after ${days} days, or when either of you marks it resolved.`,
  ]
}

/**
 * Full guide for one role. Import this on a How it works screen.
 * @param {'rider' | 'driver'} role
 * @param {number} [days]
 */
export function messagingGuide(role, days = MESSAGING_LOST_ITEM_DAYS) {
  const summary = MESSAGING_SUMMARY
  switch (role) {
    case 'driver':
      return {
        title: 'How messaging works',
        summary,
        lostItemTitle: 'Report a lost item',
        lostItemSteps: driverLostItemSteps(days),
        reportHint: 'Tap this if a rider left something in your car. Describe the item. The rider is notified. Then you can chat to arrange the return.',
        infoLabel: 'How messaging works',
      }
    case 'rider':
      return {
        title: 'How messaging works',
        summary,
        lostItemTitle: 'If a lost item is reported',
        lostItemSteps: riderLostItemSteps(days),
        reportHint: 'Tap this if you left something in the car. Describe the item. Your driver is notified. Then you can chat to arrange the return.',
        infoLabel: 'How messaging works',
      }
    default: {
      const unexpected = role
      throw new Error(`Unexpected messaging role: ${unexpected}`)
    }
  }
}
