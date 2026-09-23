/**
 * GET  /api/admin-drivers            queue for john@gmail.com / admins
 * GET  /api/admin-drivers?profile_id signed document URLs
 * POST /api/admin-drivers            { profileId, decision: approve|reject, reason }
 */
import { blockerLabel, isAdminIdentity, onboardingLabel, submissionBlockers } from '../shared/driverOnboarding.js'
import { loadSubmissionContext } from '../server/driverApproval.js'
import {
  admin, cors, json, parseBody, userFromAuth,
} from '../server/friendRideLib.js'

const APP_COLS = 'id, profile_id, onboarding_status, status, is_student, has_car, has_insurance, wants_extra_money, attestation_accepted_at, background_authorized_at, work_eligibility_attested_at, work_eligibility_category, submitted_at, reviewed_at, reviewed_by, rejection_reason, review_note, admin_notified_at, notify_error, created_at'

async function requireAdmin(sb, user) {
  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, email, full_name, role, is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (error) return { error: error.message, status: 500 }
  const ok = isAdminIdentity({
    jwtEmail: user.email,
    role: profile?.role,
    isAdmin: profile?.is_admin,
  })
  if (!ok) return { error: 'Admin only', status: 403 }
  return { profile }
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const gate = await requireAdmin(sb, user)
  if (gate.error) return json(res, gate.status, { error: gate.error })

  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const profileId = url.searchParams.get('profile_id')
    if (profileId) return detail(sb, res, profileId)
    const status = url.searchParams.get('status')
    return queue(sb, res, status)
  }

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  return review(sb, res, user, body)
}

async function queue(sb, res, status) {
  let q = sb.from('driver_applications').select(APP_COLS).order('submitted_at', { ascending: false })
  if (status) q = q.eq('onboarding_status', status)
  const { data: apps, error } = await q
  if (error) return json(res, 500, { error: error.message })
  const ids = (apps || []).map((a) => a.profile_id)
  if (!ids.length) {
    return json(res, 200, { applications: [], email_todo_present: false })
  }

  const [{ data: profiles }, { data: vehicles }, { data: docs }, { data: taxes }, { data: agreements }] = await Promise.all([
    sb.from('profiles').select('id, full_name, email, phone, role, is_admin').in('id', ids),
    sb.from('vehicles').select('driver_id, make, model, color, plate, seats, is_tesla').in('driver_id', ids),
    sb.from('driver_documents').select('profile_id, doc_type').in('profile_id', ids),
    sb.from('driver_tax_info').select('profile_id, legal_name, tin_last4, tax_classification').in('profile_id', ids),
    sb.from('driver_agreements').select('profile_id, agreement_version, signature_name, signed_at, agreement_sha256').in('profile_id', ids),
  ])
  const profileById = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  const vehicleById = {}
  for (const v of vehicles || []) {
    if (!vehicleById[v.driver_id]) vehicleById[v.driver_id] = v
  }
  const docsByProfile = {}
  for (const doc of docs || []) {
    if (!docsByProfile[doc.profile_id]) docsByProfile[doc.profile_id] = []
    docsByProfile[doc.profile_id].push(doc.doc_type)
  }
  const taxByProfile = Object.fromEntries((taxes || []).map((row) => [row.profile_id, {
    legal_name: row.legal_name,
    tin_last4: row.tin_last4,
    tax_classification: row.tax_classification,
  }]))
  const agreementByProfile = {}
  for (const row of agreements || []) {
    agreementByProfile[row.profile_id] = {
      agreement_version: row.agreement_version,
      agreement_sha256: row.agreement_sha256,
      signature_name: row.signature_name,
      signed_at: row.signed_at,
    }
  }

  const applications = (apps || []).map((app) => {
    const tax = taxByProfile[app.profile_id] || null
    const agreement = agreementByProfile[app.profile_id] || null
    const blockers = submissionBlockers({
      uploaded: docsByProfile[app.profile_id] || [],
      backgroundAuthorized: Boolean(app.background_authorized_at),
      workEligibilityAttested: Boolean(app.work_eligibility_attested_at),
      workEligibilityCategory: app.work_eligibility_category,
      taxSaved: Boolean(tax?.legal_name && /^[0-9]{4}$/.test(String(tax.tin_last4 || ''))),
      agreementSigned: Boolean(agreement?.signed_at && agreement?.signature_name),
      agreementVersion: agreement?.agreement_version || null,
    })
    return {
      ...app,
      label: onboardingLabel(app.onboarding_status),
      profile: profileById[app.profile_id] || null,
      vehicle: vehicleById[app.profile_id] || null,
      tax,
      agreement,
      blockers,
      blocker_labels: blockers.map(blockerLabel),
    }
  })

  return json(res, 200, {
    applications,
    email_todo_present: applications.some((a) => a.notify_error),
  })
}

async function detail(sb, res, profileId) {
  const { data: docs, error } = await sb
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('profile_id', profileId)
  if (error) return json(res, 500, { error: error.message })

  const documents = []
  for (const doc of docs || []) {
    const signed = await sb.storage.from('driver-documents').createSignedUrl(doc.storage_path, 60 * 30)
    documents.push({
      id: doc.id,
      doc_type: doc.doc_type,
      storage_path: doc.storage_path,
      created_at: doc.created_at,
      url: signed.data?.signedUrl || null,
      error: signed.error?.message || null,
    })
  }
  const compliance = await loadSubmissionContext(sb, profileId)
  if (compliance.error) return json(res, 500, { error: compliance.error })
  return json(res, 200, {
    profile_id: profileId,
    documents,
    employment: compliance.employment,
    tax: compliance.tax,
    agreement: compliance.agreement,
    blockers: compliance.blockers,
    blocker_labels: compliance.blockers.map(blockerLabel),
  })
}

async function review(sb, res, adminUser, body) {
  const profileId = String(body.profileId || body.profile_id || '').trim()
  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : ''
  const reason = String(body.reason || '').trim()
  if (!profileId) return json(res, 400, { error: 'profileId is required' })
  if (!decision) return json(res, 400, { error: 'decision must be approve or reject' })
  if (decision === 'reject' && reason.length < 3) {
    return json(res, 400, { error: 'A rejection reason is required' })
  }

  const { data: target, error: targetErr } = await sb
    .from('profiles')
    .select('id, role')
    .eq('id', profileId)
    .maybeSingle()
  if (targetErr) return json(res, 500, { error: targetErr.message })
  if (!target) return json(res, 404, { error: 'Driver profile not found' })

  if (decision === 'approve') {
    const compliance = await loadSubmissionContext(sb, profileId)
    if (compliance.error) return json(res, 500, { error: compliance.error })
    const alreadyApproved = compliance.onboarding_status === 'approved'
    if (!alreadyApproved && compliance.blockers.length) {
      return json(res, 400, {
        error: 'Review every required document, the W-9, and the signed agreement before approving.',
        missing: compliance.blockers,
        missing_labels: compliance.blockers.map(blockerLabel),
      })
    }
  }

  const now = new Date().toISOString()
  const next = decision === 'approve' ? 'approved' : 'rejected'
  const { data: app, error: appErr } = await sb
    .from('driver_applications')
    .update({
      onboarding_status: next,
      status: next,
      reviewed_at: now,
      reviewed_by: adminUser.id,
      rejection_reason: decision === 'reject' ? reason : null,
    })
    .eq('profile_id', profileId)
    .select('*')
    .maybeSingle()
  if (appErr) return json(res, 500, { error: appErr.message })
  if (!app) return json(res, 404, { error: 'Application not found' })

  if (decision === 'approve') {
    if (target.role !== 'admin' && target.role !== 'ops') {
      const { error } = await sb.from('profiles').update({ role: 'driver', updated_at: now }).eq('id', profileId)
      if (error) return json(res, 500, { error: error.message })
    }
  } else {
    if (target.role === 'driver') {
      const { error } = await sb.from('profiles').update({ role: 'rider', updated_at: now }).eq('id', profileId)
      if (error) return json(res, 500, { error: error.message })
    }
    const { error } = await sb.from('driver_status').upsert({
      driver_id: profileId,
      online: false,
      updated_at: now,
    })
    if (error) return json(res, 500, { error: error.message })
  }

  return json(res, 200, {
    ok: true,
    onboarding_status: next,
    application: app,
    message: decision === 'approve'
      ? 'Driver approved. They can go online and receive rides.'
      : 'Driver rejected. They cannot receive rides until they resubmit and you approve.',
  })
}
