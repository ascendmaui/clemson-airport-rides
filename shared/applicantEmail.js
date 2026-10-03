/** Email submitted with a driver application, and the Resend from address for those notices. */

export const APPLICANT_FROM_ADDRESS = 'applications@clemsonrides.com'

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
    : (email ? { id: app.profile_id, full_name: null, email } : null)
  return {
    ...app,
    applicant_email: email || null,
    profile: nextProfile,
  }
}

export async function upsertDriverApplication(sb, row, email) {
  const payload = withApplicantEmail(row, email)
  const first = await sb.from('driver_applications').upsert(payload, { onConflict: 'profile_id' }).select('*').single()
  if (!first.error || !missingApplicantEmailColumn(first.error)) return first
  return sb.from('driver_applications').upsert(withoutApplicantEmail(payload), { onConflict: 'profile_id' }).select('*').single()
}

export async function updateDriverApplication(sb, profileId, patch, email) {
  const payload = email == null ? patch : withApplicantEmail(patch, email)
  const first = await sb.from('driver_applications').update(payload).eq('profile_id', profileId).select('*').single()
  if (!first.error || !missingApplicantEmailColumn(first.error)) return first
  return sb.from('driver_applications').update(withoutApplicantEmail(payload)).eq('profile_id', profileId).select('*').single()
}

export async function selectDriverApplicationQueue(sb, columns, status) {
  const withEmail = /\bapplicant_email\b/.test(columns) ? columns : `${columns}, applicant_email`
  const run = (cols) => {
    let query = sb.from('driver_applications').select(cols).order('submitted_at', { ascending: false })
    if (status) query = query.eq('onboarding_status', status)
    return query
  }
  const first = await run(withEmail)
  if (first.error && missingApplicantEmailColumn(first.error)) return run(columns)
  return first
}

/** Profile row plus the address Resend should use. A missing applicant_email column falls back to the profile. */
export async function loadApplicantRecipient(sb, profileId) {
  const profile = await sb.from('profiles').select('id, email, full_name').eq('id', profileId).maybeSingle()
  if (profile.error) return { error: profile.error.message, status: 500 }
  if (!profile.data) return { error: 'Applicant not found', status: 404 }

  const app = await sb.from('driver_applications').select('applicant_email').eq('profile_id', profileId).maybeSingle()
  if (app.error && !missingApplicantEmailColumn(app.error)) {
    return { error: app.error.message, status: 500 }
  }
  const email = submittedApplicantEmail(
    { applicant_email: app.error ? '' : app.data?.applicant_email },
    profile.data,
  )
  return { profile: profile.data, email }
}
