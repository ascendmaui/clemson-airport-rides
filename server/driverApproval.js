/**
 * Server helpers for the driver approval gate.
 * Email is best-effort: the admin queue is the source of truth when Resend is unset.
 */
import {
  ADMIN_EMAIL,
  EMAIL_TODO,
  IC_AGREEMENT_VERSION,
  SEEDED_ADMIN_EMAILS,
  canReceiveRides,
  submissionBlockers,
} from '../shared/driverOnboarding.js'
import { WEB_ORIGIN } from '../shared/productLinks.js'
import { loadStaffAccess } from './staffAccess.js'

export { canReceiveRides }

/** Loads review context. Never selects driver_tax_secrets.tin. */
export async function loadSubmissionContext(sb, profileId) {
  let docsRes = await sb.from('driver_documents').select('doc_type, match_status, review_status').eq('profile_id', profileId)
  if (docsRes.error && /match_status|review_status|schema cache/i.test(docsRes.error.message || '')) {
    docsRes = await sb.from('driver_documents').select('doc_type').eq('profile_id', profileId)
  }
  const [appRes, taxRes, agreementRes] = await Promise.all([
    sb.from('driver_applications')
      .select('background_authorized_at, work_eligibility_attested_at, work_eligibility_category, onboarding_status')
      .eq('profile_id', profileId)
      .maybeSingle(),
    sb.from('driver_tax_info').select('legal_name, tin_last4, tax_classification').eq('profile_id', profileId).maybeSingle(),
    sb.from('driver_agreements')
      .select('agreement_version, agreement_sha256, signature_name, signed_at, signer_user_id, html_snapshot')
      .eq('profile_id', profileId)
      .eq('agreement_version', IC_AGREEMENT_VERSION)
      .maybeSingle(),
  ])
  const error = docsRes.error || appRes.error || taxRes.error || agreementRes.error
  if (error) return { error: error.message }

  const tax = taxRes.data || null
  const agreement = agreementRes.data || null
  const app = appRes.data || null
  if (tax && Object.prototype.hasOwnProperty.call(tax, 'tin')) delete tax.tin

  const ctx = {
    uploaded: (docsRes.data || []).map((row) => row.doc_type),
    backgroundAuthorized: Boolean(app?.background_authorized_at),
    workEligibilityAttested: Boolean(app?.work_eligibility_attested_at),
    workEligibilityCategory: app?.work_eligibility_category || null,
    taxSaved: Boolean(tax?.legal_name && /^[0-9]{4}$/.test(String(tax.tin_last4 || ''))),
    agreementSigned: Boolean(agreement?.signed_at && agreement?.signature_name),
    agreementVersion: agreement?.agreement_version || null,
    registrationMatch: (docsRes.data || []).find((row) => row.doc_type === 'registration')?.match_status || null,
  }

  return {
    ctx,
    blockers: submissionBlockers(ctx),
    tax: tax
      ? {
        legal_name: tax.legal_name,
        tin_last4: tax.tin_last4,
        tax_classification: tax.tax_classification,
      }
      : null,
    agreement: agreement
      ? {
        agreement_version: agreement.agreement_version,
        agreement_sha256: agreement.agreement_sha256,
        signature_name: agreement.signature_name,
        signed_at: agreement.signed_at,
        signer_user_id: agreement.signer_user_id,
        html_snapshot: agreement.html_snapshot,
      }
      : null,
    employment: {
      background_authorized_at: app?.background_authorized_at || null,
      work_eligibility_attested_at: app?.work_eligibility_attested_at || null,
      work_eligibility_category: app?.work_eligibility_category || null,
    },
    onboarding_status: app?.onboarding_status || null,
  }
}

/** Staff and admins may receive rides without onboarding_status = approved. */
async function staffMayReceiveRides(sb, profileId) {
  try {
    const first = await loadStaffAccess(sb, { id: profileId })
    if (first?.admin || first?.support) return true
    const email = first?.profile?.email
    if (!email) return false
    const second = await loadStaffAccess(sb, { id: profileId, email })
    return Boolean(second?.admin || second?.support)
  } catch {
    return false
  }
}

export async function driverApprovalStatus(sb, profileId) {
  const { data, error } = await sb
    .from('driver_applications')
    .select('onboarding_status')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) return { approved: false, status: null, error: error.message }
  const status = data?.onboarding_status || null
  if (canReceiveRides(status)) return { approved: true, status, error: null }
  if (await staffMayReceiveRides(sb, profileId)) return { approved: true, status, error: null }
  return { approved: false, status, error: null }
}

/**
 * Which candidate profile ids may be offered, matched, notified, or assigned a ride.
 * One driver_applications read for the whole list. Anyone not approved still passes
 * when loadStaffAccess says they are staff or admin.
 */
export async function receivableDriverIds(sb, profileIds) {
  const ids = []
  const seen = new Set()
  for (const raw of profileIds || []) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) return { allowed: new Set(), error: null }

  const { data, error } = await sb
    .from('driver_applications')
    .select('profile_id, onboarding_status')
    .in('profile_id', ids)
  if (error) {
    return { allowed: new Set(), error: error.message || 'Could not read driver approval' }
  }

  const statusById = new Map()
  for (const row of data || []) {
    if (row?.profile_id) statusById.set(row.profile_id, row.onboarding_status ?? null)
  }

  const allowed = new Set()
  const unchecked = []
  for (const id of ids) {
    if (canReceiveRides(statusById.get(id))) allowed.add(id)
    else unchecked.push(id)
  }
  if (!unchecked.length) return { allowed, error: null }

  await Promise.all(unchecked.map(async (id) => {
    if (await staffMayReceiveRides(sb, id)) allowed.add(id)
  }))
  return { allowed, error: null }
}

export async function notifyAdminOfApplication({ profile, vehicle }) {
  const configured = (process.env.ADMIN_NOTIFY_EMAIL || '').trim()
  const recipients = configured
    ? configured.split(',').map((email) => email.trim()).filter(Boolean)
    : SEEDED_ADMIN_EMAILS
  const to = recipients[0] || ADMIN_EMAIL
  const key = (process.env.RESEND_API_KEY || '').trim()
  const appUrl = (process.env.VITE_APP_URL || process.env.APP_URL || WEB_ORIGIN).replace(/\/$/, '')
  const name = profile?.full_name || profile?.email || 'New driver'
  const vehicleLabel = [vehicle?.color, vehicle?.make, vehicle?.model, vehicle?.plate].filter(Boolean).join(' ')
  const queueUrl = `${appUrl}/#/admin`

  if (!key || key.includes('placeholder')) {
    console.warn(`[driver-onboarding] ${EMAIL_TODO}`)
    return { emailed: false, todo: EMAIL_TODO, to }
  }

  const from = (process.env.RESEND_FROM || '').trim()
  if (!from) {
    const todo = `${EMAIL_TODO} RESEND_API_KEY is set but RESEND_FROM is empty.`
    console.warn(`[driver-onboarding] ${todo}`)
    return { emailed: false, todo, to }
  }

  const text = [
    `${name} submitted a Clemson RIDES driver application and is waiting for review.`,
    profile?.email ? `Email: ${profile.email}` : null,
    profile?.phone ? `Phone: ${profile.phone}` : null,
    vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
    '',
    `Open the admin queue: ${queueUrl}`,
    'Drivers cannot receive rides until you approve them.',
  ].filter((line) => line != null).join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: `Driver application ready for review — ${name}`,
        text,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const todo = `Resend failed (${res.status}): ${body.message || body.error || 'email not sent'}. ${EMAIL_TODO}`
      console.warn('[driver-onboarding]', todo)
      return { emailed: false, todo, to }
    }
    return { emailed: true, id: body.id || null, to }
  } catch (err) {
    const todo = `Resend request failed: ${err.message || err}. ${EMAIL_TODO}`
    console.warn('[driver-onboarding]', todo)
    return { emailed: false, todo, to }
  }
}
