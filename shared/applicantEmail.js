/** Email submitted with a driver application. Display only — this module does not send mail. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeApplicantEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return ''
  return email
}

/** Stored application email wins. Profile email is the fallback for rows saved before that column. */
export function submittedApplicantEmail(application, profile) {
  return normalizeApplicantEmail(application?.applicant_email)
    || normalizeApplicantEmail(profile?.email)
}

export function withApplicantEmail(row, email) {
  const applicantEmail = normalizeApplicantEmail(email)
  if (!applicantEmail) return { ...row }
  return { ...row, applicant_email: applicantEmail }
}

export function withoutApplicantEmail(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'applicant_email')) return row
  const next = { ...row }
  delete next.applicant_email
  return next
}

export function missingApplicantEmailColumn(error) {
  const message = String(error?.message || error || '')
  return /applicant_email/i.test(message) && /schema cache|column|does not exist/i.test(message)
}

/** Queue row the admin list renders. The submitted address is on both applicant_email and profile.email. */
export function withSubmittedApplicantEmail(app, profile) {
  const email = submittedApplicantEmail(app, profile)
  const nextProfile = profile
    ? { ...profile, email: email || null }
    : (email ? { id: app?.profile_id, full_name: null, email } : null)
  return {
    ...app,
    applicant_email: email || null,
    profile: nextProfile,
  }
}

/**
 * Writes the application row, including the submitted email when the column exists.
 * A database that has not added applicant_email yet is retried without that field.
 */
export async function writeDriverApplication(run, row, email) {
  const payload = withApplicantEmail(row, email)
  const first = await run(payload)
  if (!first?.error || !missingApplicantEmailColumn(first.error)) return first
  return run(withoutApplicantEmail(payload))
}

/** Reads the address stored on the application. A missing column is an empty address, not a failure. */
export async function readStoredApplicantEmail(sb, profileId) {
  const first = await sb
    .from('driver_applications')
    .select('applicant_email')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (first?.error && missingApplicantEmailColumn(first.error)) return { email: '', error: null }
  if (first?.error) return { email: '', error: first.error }
  return { email: normalizeApplicantEmail(first?.data?.applicant_email), error: null }
}

export async function selectDriverApplicationQueue(sb, columns, status) {
  const base = String(columns || '').trim()
  const withEmail = /\bapplicant_email\b/.test(base) ? base : `${base}, applicant_email`
  const run = (cols) => {
    let query = sb.from('driver_applications').select(cols).order('submitted_at', { ascending: false })
    if (status) query = query.eq('onboarding_status', status)
    return query
  }
  const first = await run(withEmail)
  if (first?.error && missingApplicantEmailColumn(first.error)) return run(base)
  return first
}
