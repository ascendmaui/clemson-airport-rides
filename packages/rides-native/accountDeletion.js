import { ACCOUNT_DELETION_TICKET } from '../../shared/accountDeletion.js'

export { ACCOUNT_DELETION_TICKET } from '../../shared/accountDeletion.js'

/**
 * Builds a validated, formatted account deletion support ticket payload.
 * Provides a safe helper so callers do not have to manually format the body string
 * or risk malformed email / roleVariant values.
 *
 * @param {Object} [options]
 * @param {string | null | undefined} [options.email] - User's account email. If missing or blank, defaults to 'on file'.
 * @param {'rider' | 'driver'} [options.roleVariant='rider'] - Role variant filing the deletion request ('rider' or 'driver').
 * @param {string} [options.subject] - Optional custom ticket subject.
 * @returns {typeof ACCOUNT_DELETION_TICKET & { body: string, roleVariant: 'rider' | 'driver' }}
 */
export function buildAccountDeletionTicket({ email, roleVariant = 'rider', subject } = {}) {
  const normalizedEmail = typeof email === 'string' && email.trim().length > 0 ? email.trim() : 'on file'
  const normalizedRole = roleVariant === 'driver' ? 'driver' : 'rider'
  const customSubject = typeof subject === 'string' && subject.trim().length > 0 ? subject.trim() : undefined

  return Object.freeze({
    ...ACCOUNT_DELETION_TICKET,
    roleVariant: normalizedRole,
    ...(customSubject ? { subject: customSubject } : {}),
    body: `${ACCOUNT_DELETION_TICKET.body} Account email: ${normalizedEmail}.`,
  })
}
