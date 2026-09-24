/**
 * Clemson student domain gate. Guest browse stays open.
 * Pricing uses the signed-in auth email only — not a client `student` flag
 * and not `profiles.student_verified_at` by itself.
 * @g.clemson.edu is Clemson Google Workspace and does not end with "@clemson.edu".
 */
export const CLEMSON_STUDENT_DOMAINS = ['clemson.edu', 'g.clemson.edu']

export const STUDENT_EMAIL_REQUIRED_COPY =
  'Student pricing needs a Clemson student email (@clemson.edu or @g.clemson.edu) on this account. Sign in with that address. Other emails stay at full price.'

export const STUDENT_CONFIRM_EMAIL_COPY =
  'Confirm the Clemson email on this account. Student pricing starts after that address is confirmed. The sign-in email we already send is the check — there is no separate student ID step.'

export function isClemsonEmail(email) {
  if (!email || typeof email !== 'string') return false
  const value = email.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at <= 0) return false
  const domain = value.slice(at + 1)
  return CLEMSON_STUDENT_DOMAINS.includes(domain)
}

/** 'confirmed' | 'unconfirmed' | 'unknown' from a Supabase or Clerk-bridged auth user. */
export function emailConfirmationState(user) {
  if (!user || typeof user !== 'object') return 'unknown'
  if (user.email_confirmed_at || user.confirmed_at) return 'confirmed'
  const identities = Array.isArray(user.identities) ? user.identities : []
  const identityConfirmed = identities.some((row) => {
    const data = row && typeof row === 'object' ? row.identity_data : null
    if (!data || typeof data !== 'object') return false
    return data.email_verified === true || data.email_verified === 'true'
  })
  if (identityConfirmed) return 'confirmed'
  if ('email_confirmed_at' in user || 'confirmed_at' in user || identities.length > 0) return 'unconfirmed'
  return 'unknown'
}

/**
 * 10% Standard discount. Requires a confirmed auth email on an allowed domain.
 * `user.student_verified_at` and any client isStudent flag are ignored.
 */
export function studentDiscountGranted(user) {
  if (!user || typeof user !== 'object') return false
  if (emailConfirmationState(user) !== 'confirmed') return false
  return isClemsonEmail(user.email)
}
