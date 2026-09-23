import { supabase } from './supabase'
import {
  EMAIL_TODO,
  REQUIRED_DOCUMENTS,
  REQUIRED_DOC_IDS,
  isRequiredDocType,
  legacyStatusFor,
  missingDocuments,
  onboardingLabel,
  statusAfterInfoSave,
  canReceiveRides,
  isAdminIdentity,
  ADMIN_EMAIL,
  ONBOARDING_FLOW,
  flowStep,
  firstIncompleteStepId,
  resolveResumeStep,
  progressSnapshot,
  stepIsComplete,
  canOpenStep,
  adjacentStep,
  IC_AGREEMENT_HTML,
  IC_AGREEMENT_TITLE,
  IC_AGREEMENT_VERSION,
  WORK_ELIGIBILITY_CATEGORIES,
  TAX_CLASSIFICATIONS,
  displayTinLast4,
  submissionBlockers,
  blockerLabel,
} from '../../shared/driverOnboarding.js'

export {
  EMAIL_TODO,
  REQUIRED_DOCUMENTS,
  REQUIRED_DOC_IDS,
  missingDocuments,
  onboardingLabel,
  canReceiveRides,
  isAdminIdentity,
  ADMIN_EMAIL,
  ONBOARDING_FLOW,
  flowStep,
  firstIncompleteStepId,
  resolveResumeStep,
  progressSnapshot,
  stepIsComplete,
  canOpenStep,
  adjacentStep,
  IC_AGREEMENT_HTML,
  IC_AGREEMENT_TITLE,
  IC_AGREEMENT_VERSION,
  WORK_ELIGIBILITY_CATEGORIES,
  TAX_CLASSIFICATIONS,
  displayTinLast4,
  submissionBlockers,
  blockerLabel,
}

const STEP_KEY = (userId) => `clemson_driver_onboarding_step:${userId}`

export function readOnboardingStep(userId) {
  if (!userId || typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(STEP_KEY(userId))
  } catch {
    return null
  }
}

export function writeOnboardingStep(userId, stepId) {
  if (!userId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STEP_KEY(userId), stepId)
  } catch {
    /* private mode */
  }
}

const MAX_BYTES = 8 * 1024 * 1024

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function postJson(path, body) {
  const headers = await authHeaders()
  let res
  try {
    res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body || {}) })
  } catch (err) {
    const error = new Error(err?.message || 'Network error')
    error.network = true
    throw error
  }
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    const error = new Error('API unavailable')
    error.unavailable = true
    error.status = res.status
    throw error
  }
  if (!res.ok) {
    const error = new Error(data.error || data.message || `HTTP ${res.status}`)
    error.status = res.status
    error.payload = data
    if (res.status === 404) error.unavailable = true
    throw error
  }
  return data
}

export async function fetchMyDriverApplication(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('driver_applications')
    .select('id, profile_id, onboarding_status, status, rejection_reason, review_note, submitted_at, reviewed_at, notify_error, admin_notified_at, background_authorized_at, work_eligibility_attested_at, work_eligibility_category')
    .eq('profile_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchMyDriverDocuments(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('profile_id', userId)
  if (error) throw new Error(error.message)
  const rows = data || []
  const withUrls = []
  for (const row of rows) {
    const signed = await supabase.storage.from('driver-documents').createSignedUrl(row.storage_path, 60 * 20)
    withUrls.push({ ...row, url: signed.data?.signedUrl || null })
  }
  return withUrls
}

export async function uploadDriverDocument(userId, docType, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!userId) throw new Error('Sign in required')
  if (!isRequiredDocType(docType)) throw new Error('Unknown document type')
  if (!file) throw new Error('Choose a file')
  if (file.size > MAX_BYTES) throw new Error('Each file must be 8MB or smaller')
  const type = file.type || ''
  const allowed = type.startsWith('image/') || type === 'application/pdf'
  if (type && !allowed) throw new Error('Upload a photo or PDF')

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${docType}/${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('driver-documents').upload(path, file, {
    contentType: type || 'image/jpeg',
    upsert: false,
  })
  if (upErr) throw new Error(upErr.message)

  const { data: previous } = await supabase
    .from('driver_documents')
    .select('storage_path')
    .eq('profile_id', userId)
    .eq('doc_type', docType)
    .maybeSingle()

  const { error: rowErr } = await supabase.from('driver_documents').upsert(
    {
      profile_id: userId,
      doc_type: docType,
      storage_path: path,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,doc_type' },
  )
  if (rowErr) throw new Error(rowErr.message)

  if (previous?.storage_path && previous.storage_path !== path) {
    await supabase.storage.from('driver-documents').remove([previous.storage_path])
  }

  const signed = await supabase.storage.from('driver-documents').createSignedUrl(path, 60 * 20)
  return { doc_type: docType, storage_path: path, url: signed.data?.signedUrl || null }
}

async function saveDriverInfoDirect(userId, payload, email) {
  const { data: existing, error: existingErr } = await supabase
    .from('driver_applications')
    .select('onboarding_status')
    .eq('profile_id', userId)
    .maybeSingle()
  if (existingErr) throw new Error(existingErr.message)

  const nextStatus = statusAfterInfoSave(existing?.onboarding_status || null)
  const now = new Date().toISOString()
  const isClemson = String(email || '').toLowerCase().endsWith('@clemson.edu')
    || String(email || '').toLowerCase().endsWith('@g.clemson.edu')

  const profilePatch = {
    id: userId,
    full_name: payload.fullName,
    phone: payload.phone,
    email: email || null,
    updated_at: now,
  }
  if (isClemson) profilePatch.student_verified_at = now
  const { error: profileErr } = await supabase.from('profiles').upsert(profilePatch)
  if (profileErr) throw new Error(profileErr.message)

  const { data: app, error: appErr } = await supabase
    .from('driver_applications')
    .upsert(
      {
        profile_id: userId,
        is_student: true,
        has_car: true,
        has_insurance: true,
        wants_extra_money: true,
        attestation_accepted_at: now,
        onboarding_status: nextStatus,
        status: legacyStatusFor(nextStatus),
      },
      { onConflict: 'profile_id' },
    )
    .select('*')
    .single()
  if (appErr) throw new Error(appErr.message)

  const { data: existingVeh } = await supabase
    .from('vehicles')
    .select('id')
    .eq('driver_id', userId)
    .limit(1)
  const vehFields = {
    make: payload.make,
    model: payload.model,
    color: payload.color || null,
    plate: payload.plate,
    seats: payload.seats || 4,
    is_tesla: Boolean(payload.isTesla),
    autonomous_capable: Boolean(payload.isTesla),
    tier: payload.isTesla ? 'tesla_self_driving' : 'standard',
  }
  let vehicle = existingVeh?.[0] || null
  if (!vehicle) {
    const { data: inserted, error } = await supabase
      .from('vehicles')
      .insert({ driver_id: userId, ...vehFields })
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    vehicle = inserted
  } else {
    const { data: updated, error } = await supabase
      .from('vehicles')
      .update(vehFields)
      .eq('id', vehicle.id)
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    vehicle = updated
  }

  await supabase.from('driver_status').upsert({
    driver_id: userId,
    online: false,
    updated_at: now,
  })

  return {
    ok: true,
    application: app,
    onboarding_status: nextStatus,
    approved: nextStatus === 'approved',
    vehicle,
    direct: true,
    message: nextStatus === 'approved'
      ? 'Your driver profile is already approved.'
      : 'Info saved. Upload your documents next. An admin must approve you before you can receive rides.',
  }
}

export async function saveDriverInfo(user, payload) {
  if (!user?.id) throw new Error('Sign in required')
  try {
    return await postJson('/api/driver?action=signup', payload)
  } catch (err) {
    if (!err.unavailable && !err.network) throw err
    return saveDriverInfoDirect(user.id, payload, user.email)
  }
}

export async function saveEmploymentVerification(userId, { backgroundAuthorized, category }) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!userId) throw new Error('Sign in required')
  if (!backgroundAuthorized) throw new Error('Authorize the background check to continue.')
  if (!WORK_ELIGIBILITY_CATEGORIES.some((item) => item.id === category)) {
    throw new Error('Select your eligibility to work.')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('driver_applications')
    .update({
      background_authorized_at: now,
      work_eligibility_attested_at: now,
      work_eligibility_category: category,
    })
    .eq('profile_id', userId)
    .select('background_authorized_at, work_eligibility_attested_at, work_eligibility_category')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchMyTaxProfile(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('driver_tax_info')
    .select('legal_name, tin_last4, tax_classification, updated_at')
    .eq('profile_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    legal_name: data.legal_name,
    tin_last4: data.tin_last4,
    tax_classification: data.tax_classification,
    updated_at: data.updated_at,
  }
}

/** Sends the TIN only to save_driver_tax_info. The return value is last-4 only. */
export async function saveDriverTaxInfo({ legalName, tin, taxClassification }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const digits = String(tin || '').replace(/\D/g, '')
  if (digits.length !== 9) throw new Error('Enter a 9-digit TIN')
  if (!TAX_CLASSIFICATIONS.some((item) => item.id === taxClassification)) {
    throw new Error('Choose a tax classification')
  }
  const { data, error } = await supabase.rpc('save_driver_tax_info', {
    legal_name: legalName,
    tin: digits,
    tax_classification: taxClassification,
  })
  if (error) throw new Error(error.message)
  const row = data && typeof data === 'object' ? data : {}
  return {
    legal_name: row.legal_name || legalName,
    tin_last4: row.tin_last4,
    tax_classification: row.tax_classification || taxClassification,
  }
}

export async function fetchAgreementVersion() {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('driver_agreement_versions')
    .select('version, title, body_html, sha256')
    .eq('version', IC_AGREEMENT_VERSION)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchMyAgreement(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('driver_agreements')
    .select('agreement_version, agreement_sha256, signature_name, signed_at, signer_user_id')
    .eq('profile_id', userId)
    .eq('agreement_version', IC_AGREEMENT_VERSION)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function signDriverAgreement(signatureName) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('sign_driver_agreement', {
    signature_name: signatureName,
  })
  if (error) throw new Error(error.message)
  const row = data && typeof data === 'object' ? data : {}
  return {
    agreement_version: row.agreement_version,
    agreement_sha256: row.agreement_sha256,
    signature_name: row.signature_name,
    signed_at: row.signed_at,
    signer_user_id: row.signer_user_id,
  }
}

function complianceContext({ application, documents, tax, agreement }) {
  return {
    uploaded: (documents || []).map((doc) => doc.doc_type),
    backgroundAuthorized: Boolean(application?.background_authorized_at),
    workEligibilityAttested: Boolean(application?.work_eligibility_attested_at),
    workEligibilityCategory: application?.work_eligibility_category || null,
    taxSaved: Boolean(tax?.legal_name && /^[0-9]{4}$/.test(String(tax?.tin_last4 || ''))),
    agreementSigned: Boolean(agreement?.signed_at && agreement?.signature_name),
    agreementVersion: agreement?.agreement_version || null,
  }
}

async function submitDriverReviewDirect(userId) {
  const [docs, tax, agreement, application] = await Promise.all([
    fetchMyDriverDocuments(userId),
    fetchMyTaxProfile(userId),
    fetchMyAgreement(userId),
    fetchMyDriverApplication(userId),
  ])
  const blockers = submissionBlockers(complianceContext({ application, documents: docs, tax, agreement }))
  if (blockers.length) {
    const error = new Error('Finish every required step before submitting for review.')
    error.payload = { missing: blockers }
    throw error
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('driver_applications')
    .update({
      onboarding_status: 'pending_review',
      status: legacyStatusFor('pending_review'),
      submitted_at: now,
      notify_error: EMAIL_TODO,
    })
    .eq('profile_id', userId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return {
    ok: true,
    onboarding_status: 'pending_review',
    application: data,
    emailed: false,
    email_todo: EMAIL_TODO,
    direct: true,
    message: 'Submitted for admin review. You cannot receive rides until you are approved.',
  }
}

export async function submitDriverReview() {
  try {
    return await postJson('/api/driver?action=submit-review', {})
  } catch (err) {
    if (!err.unavailable && !err.network) throw err
    const { data } = await supabase.auth.getUser()
    const userId = data?.user?.id
    if (!userId) throw err
    return submitDriverReviewDirect(userId)
  }
}

const APP_QUEUE_COLS = 'id, profile_id, onboarding_status, status, background_authorized_at, work_eligibility_attested_at, work_eligibility_category, submitted_at, reviewed_at, rejection_reason, review_note, notify_error'

async function fetchDriverQueueDirect(status) {
  if (!supabase) throw new Error('Supabase is not configured')
  let query = supabase.from('driver_applications').select(APP_QUEUE_COLS).order('submitted_at', { ascending: false })
  if (status) query = query.eq('onboarding_status', status)
  const { data: apps, error } = await query
  if (error) throw new Error(error.message)
  const ids = (apps || []).map((app) => app.profile_id)
  if (!ids.length) return { applications: [], email_todo_present: false, direct: true }

  const [{ data: profiles }, { data: vehicles }, { data: docs }, { data: taxes }, { data: agreements }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, phone, role, is_admin').in('id', ids),
    supabase.from('vehicles').select('driver_id, make, model, color, plate, seats, is_tesla').in('driver_id', ids),
    supabase.from('driver_documents').select('profile_id, doc_type').in('profile_id', ids),
    supabase.from('driver_tax_info').select('profile_id, legal_name, tin_last4, tax_classification').in('profile_id', ids),
    supabase.from('driver_agreements').select('profile_id, agreement_version, signature_name, signed_at, agreement_sha256').in('profile_id', ids),
  ])
  const profileById = Object.fromEntries((profiles || []).map((row) => [row.id, row]))
  const vehicleById = {}
  for (const vehicle of vehicles || []) {
    if (!vehicleById[vehicle.driver_id]) vehicleById[vehicle.driver_id] = vehicle
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
    if (row.agreement_version === IC_AGREEMENT_VERSION) agreementByProfile[row.profile_id] = row
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
  return {
    applications,
    email_todo_present: applications.some((app) => app.notify_error),
    direct: true,
  }
}

export async function fetchDriverQueue(status) {
  const headers = await authHeaders()
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  let res
  try {
    res = await fetch(`/api/admin-drivers${qs}`, { headers })
  } catch (err) {
    const error = new Error(err?.message || 'Network error')
    error.network = true
    if (supabase) return fetchDriverQueueDirect(status)
    throw error
  }
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    if (supabase) return fetchDriverQueueDirect(status)
    const error = new Error('API unavailable')
    error.unavailable = true
    throw error
  }
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`)
    error.status = res.status
    if (res.status === 404) error.unavailable = true
    if ((error.unavailable || error.network) && supabase) return fetchDriverQueueDirect(status)
    throw error
  }
  return data
}

export async function fetchDriverReviewDetail(profileId) {
  const headers = await authHeaders()
  const res = await fetch(`/api/admin-drivers?profile_id=${encodeURIComponent(profileId)}`, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 404 && supabase) return fetchDriverReviewDetailDirect(profileId)
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  if (data.tax && Object.prototype.hasOwnProperty.call(data.tax, 'tin')) delete data.tax.tin
  return data
}

async function fetchDriverReviewDetailDirect(profileId) {
  const { data: docs, error } = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('profile_id', profileId)
  if (error) throw new Error(error.message)
  const documents = []
  for (const doc of docs || []) {
    const signed = await supabase.storage.from('driver-documents').createSignedUrl(doc.storage_path, 60 * 30)
    documents.push({
      id: doc.id,
      doc_type: doc.doc_type,
      storage_path: doc.storage_path,
      created_at: doc.created_at,
      url: signed.data?.signedUrl || null,
    })
  }
  const [application, tax, agreement] = await Promise.all([
    fetchMyDriverApplication(profileId),
    fetchMyTaxProfile(profileId),
    fetchMyAgreement(profileId),
  ])
  const ctx = complianceContext({ application, documents, tax, agreement })
  const blockers = submissionBlockers(ctx)
  return {
    profile_id: profileId,
    documents,
    employment: {
      background_authorized_at: application?.background_authorized_at || null,
      work_eligibility_attested_at: application?.work_eligibility_attested_at || null,
      work_eligibility_category: application?.work_eligibility_category || null,
    },
    tax,
    agreement,
    blockers,
    blocker_labels: blockers.map(blockerLabel),
    direct: true,
  }
}

export async function reviewDriverApplication({ profileId, decision, reason }) {
  try {
    return await postJson('/api/admin-drivers', { profileId, decision, reason })
  } catch (err) {
    if (!err.unavailable && !err.network) throw err
    if (!supabase) throw err
    const { data, error } = await supabase.rpc('review_driver_application', {
      target_profile: profileId,
      decision,
      reason: reason || null,
    })
    if (error) throw new Error(error.message)
    return { ok: true, onboarding_status: decision === 'approve' ? 'approved' : 'rejected', application: data, direct: true }
  }
}
