export const CHAT_REPORT_REASONS = Object.freeze([
  'Harassment or abuse',
  'Inappropriate content',
  'Safety concern',
  'Other',
])
export const CHAT_REPORT_CONFIRMATION = 'Reported. Our team reviews reports within 24 hours.'
export const CHAT_SUPPORT_COPY = 'You can also contact support at rides@clemsonrides.com.'
export const CHAT_BLOCK_COPY = `Blocking hides this person's messages and prevents you from sending to them on this device. It does not cancel the trip. ${CHAT_SUPPORT_COPY}`

function requiredId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    throw new Error('A valid trip or user ID is required')
  }
  return value.trim()
}

/** The support pipeline escalates safety tickets for staff review. */
export function buildChatModerationTicket({
  tripId, roleVariant, reportedRole, reportedUserId, reason, message, action = 'report',
} = {}) {
  if (!['rider', 'driver'].includes(roleVariant) || !['rider', 'driver'].includes(reportedRole) || roleVariant === reportedRole) {
    throw new Error('The reporting and reported roles must be opposite trip parties')
  }
  if (!['report', 'block'].includes(action)) throw new Error('Unknown moderation action')
  const lines = [
    action === 'block' ? 'Block trip chat: I confirmed blocking this person on this device.' : 'Report trip chat: I confirmed this report for staff review.',
    `Trip ID: ${requiredId(tripId)}`,
    `Reported party role: ${reportedRole}`,
  ]
  if (reportedUserId) lines.push(`Reported user ID: ${requiredId(reportedUserId)}`)
  if (typeof reason === 'string' && reason.trim()) lines.push(`Reason: ${reason.trim().slice(0, 500)}`)
  if (message) {
    lines.push(`Reported message ID: ${requiredId(message.id)}`)
    // Real chat messages are capped at 500 characters; keep even malformed input within ticket limits.
    lines.push(`Reported message text: ${String(message.body ?? '').slice(0, 2000)}`)
  }
  return {
    confirmed: true,
    category: 'safety',
    roleVariant,
    subject: action === 'block' ? 'Report trip chat — Block' : 'Report trip chat',
    body: lines.join('\n'),
  }
}

function keyPart(id) {
  return Array.from(requiredId(id), (char) => char.codePointAt(0).toString(16)).join('-')
}

/** Per-peer keys avoid a shared list write race and are valid SecureStore keys. */
export function chatBlockKey(userId, otherUserId) {
  return `rides.chat-block.${keyPart(userId)}.${keyPart(otherUserId)}`
}

/** Inject SecureStore on native or localStorage on web; no platform imports needed. */
export function createChatBlockStore(storage) {
  const listeners = new Set()
  return {
    async isBlocked(userId, otherUserId) {
      return (await storage.getItem(chatBlockKey(userId, otherUserId))) === '1'
    },
    async setBlocked(userId, otherUserId, blocked) {
      const key = chatBlockKey(userId, otherUserId)
      if (blocked) await storage.setItem(key, '1')
      else await storage.removeItem(key)
      for (const listener of listeners) listener(key, Boolean(blocked))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
