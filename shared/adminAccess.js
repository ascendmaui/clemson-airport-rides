/**
 * Admin allow-list shared by the Vite app, native driver app, and Vercel API.
 * These addresses are identities, not secrets. Real keys stay in env placeholders.
 */

export const SEEDED_ADMIN_EMAILS = [
  'johnmatveev@gmail.com',
  'johnmatveyev@gmail.com',
  'jmat2019@icloud.com',
  'john@gmail.com',
]

/** Web /admin-dashboard lock. Refunds, credits, and incentives use this same address. */
export const DASHBOARD_ADMIN_EMAIL = 'johnmatveyev@gmail.com'

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

export function isSeedAdminEmail(email) {
  return SEEDED_ADMIN_EMAILS.includes(normalizeEmail(email))
}

/**
 * Full admin: seeded inbox, profiles.role admin/ops, or profiles.is_admin.
 * Support-only staff are not admins and cannot approve drivers.
 */
export function isAdminIdentity({ jwtEmail, role, isAdmin } = {}) {
  if (isSeedAdminEmail(jwtEmail)) return true
  if (isAdmin === true) return true
  if (role === 'admin' || role === 'ops') return true
  return false
}

export function isTicketStatus(status) {
  return TICKET_STATUSES.includes(status)
}

/**
 * Money actions stay on the dashboard admin, not every seeded inbox or ops role.
 * Riders and drivers fail isAdmin and never match.
 */
export function canUseAdminMoney({ jwtEmail, profileEmail, isAdmin } = {}) {
  if (isAdmin !== true) return false
  return [jwtEmail, profileEmail].some((email) => normalizeEmail(email) === DASHBOARD_ADMIN_EMAIL)
}
