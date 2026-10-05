/**
 * Server-only admin roster. Do not import this from the Vite app.
 * Unknown addresses are denied even when a profile flag or env list includes them.
 */
import { emailsFromList, normalizeEmail } from '../shared/adminAccess.js'

export const DENIED_ADMIN_EMAILS = [
  'john@gmail.com',
  'johnmatveev@gmail.com',
]

export const KNOWN_OWNER_EMAILS = [
  'johnmatveyev@gmail.com',
  'ascendmaui@gmail.com',
  'jmat2019@icloud.com',
]

const DENIED = new Set(DENIED_ADMIN_EMAILS)

export function isDeniedAdminEmail(email) {
  return DENIED.has(normalizeEmail(email))
}

export function serverAllowEmails(env = process.env) {
  return [...KNOWN_OWNER_EMAILS, ...emailsFromList(env.ADMIN_EMAILS)]
    .filter((email) => !DENIED.has(email))
}

export function serverIsAdmin({
  jwtEmail,
  profileEmail,
  role,
  isAdmin,
  email,
} = {}, env = process.env) {
  const candidates = [jwtEmail, profileEmail, email].map(normalizeEmail).filter(Boolean)
  if (candidates.some((value) => DENIED.has(value))) return false
  const allow = new Set(serverAllowEmails(env))
  if (candidates.some((value) => allow.has(value))) return true
  if (isAdmin === true) return true
  if (role === 'admin' || role === 'ops') return true
  return false
}

export function adminNotifyRecipients(env = process.env) {
  return emailsFromList(env.ADMIN_NOTIFY_EMAIL).filter((value) => !DENIED.has(value))
}

export function supportInboxEmails(env = process.env) {
  return emailsFromList(env.SUPPORT_ADMIN_EMAILS).filter((value) => !DENIED.has(value))
}
