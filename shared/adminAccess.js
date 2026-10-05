/**
 * Admin checks shared by the Vite app and the Vercel API.
 * Addresses are not stored here. The server roster and ADMIN_EMAILS live in
 * server/adminRoster.js so the client bundle does not ship them.
 */

export const TICKET_STATUSES = [
  'open',
  'bot_handling',
  'waiting_user',
  'escalated',
  'resolved',
]

export const BOT_CONFIDENCE_FLOOR = 0.75

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function emailsFromList(raw) {
  const source = Array.isArray(raw) ? raw.join(',') : raw
  return String(source || '')
    .split(',')
    .map((part) => normalizeEmail(part))
    .filter(Boolean)
}

/**
 * Admin when the profile role says so, or when the address is on an explicit
 * allow list. deniedEmails never qualify, including when the profile is
 * marked admin or the address is also on the allow list.
 */
export function isAdminIdentity({ jwtEmail, role, isAdmin, allowEmails, deniedEmails } = {}) {
  const email = normalizeEmail(jwtEmail)
  const denied = new Set(emailsFromList(deniedEmails))
  if (email && denied.has(email)) return false
  const allow = new Set(emailsFromList(allowEmails))
  if (email && allow.has(email)) return true
  if (isAdmin === true) return true
  if (role === 'admin' || role === 'ops') return true
  return false
}

export function isTicketStatus(status) {
  return TICKET_STATUSES.includes(status)
}
