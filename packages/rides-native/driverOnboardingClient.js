/**
 * Native driver onboarding. Same steps, RPCs, and /api/driver actions as the web app.
 * The TIN is sent only to save_driver_tax_info. Callers must not log it.
 */
import { authedJson } from './apiClient.js'
import {
  IC_AGREEMENT_HTML,
  IC_AGREEMENT_TITLE,
  IC_AGREEMENT_VERSION,
  ONBOARDING_FLOW,
  REQUIRED_DOCUMENTS,
  TAX_CLASSIFICATIONS,
  WORK_ELIGIBILITY_CATEGORIES,
  blockerLabel,
  canOpenStep,
  displayTinLast4,
  firstIncompleteStepId,
  flowStep,
  isRequiredDocType,
  legacyStatusFor,
  onboardingLabel,
  progressSnapshot,
  resolveResumeStep,
  statusAfterInfoSave,
  stepIsComplete,
  submissionBlockers,
} from '../../shared/driverOnboarding.js'

export {
  IC_AGREEMENT_TITLE,
  IC_AGREEMENT_VERSION,
  ONBOARDING_FLOW,
  REQUIRED_DOCUMENTS,
  TAX_CLASSIFICATIONS,
  WORK_ELIGIBILITY_CATEGORIES,
  blockerLabel,
  canOpenStep,
  displayTinLast4,
  flowStep,
  onboardingLabel,
  progressSnapshot,
  stepIsComplete,
  submissionBlockers,
}

const MAX_BYTES = 8 * 1024 * 1024

export function agreementPlainText(html = IC_AGREEMENT_HTML) {
  return String(html)
    .replace(/<h1>/gi, '')
    .replace(/<h2>/gi, '\n')
    .replace(/<\/h[12]>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function complianceContext({ application, documents, tax, agreement }) {
  return {
    status: application?.onboarding_status || null,
    uploaded: (documents || []).map((doc) => doc.doc_type),
    backgroundAuthorized: Boolean(application?.background_authorized_at),
    workEligibilityAttested: Boolean(application?.work_eligibility_attested_at),
    workEligibilityCategory: application?.work_eligibility_category || null,
    taxSaved: Boolean(tax?.legal_name && /^[0-9]{4}$/.test(String(tax?.tin_last4 || ''))),
    agreementSigned: Boolean(agreement?.signed_at && agreement?.signature_name),
    agreementVersion: agreement?.agreement_version || null,
  }
}

export async function fetchMyDriverApplication(supabase, userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('driver_applications')
    .select('id, profile_id, onboarding_status, status, rejection_reason, review_note, submitted_at, reviewed_at, background_authorized_at, work_eligibility_attested_at, work_eligibility_category')
    .eq('profile_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchMyDriverDocuments(supabase, userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('profile_id', userId)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchMyTaxProfile(supabase, userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('driver_tax_info')
    .select('legal_name, tin_last4, tax_classification, updated_at')
    .eq('profile_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchMyAgreement(supabase, userId) {
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

export async function loadApplicantInbox(supabase) {
  return authedJson(supabase, '/api/driver?action=inbox')
}

export async function replyApplicantInbox(supabase, body) {
  return authedJson(supabase, '/api/driver?action=inbox', { method: 'POST', body: { body } })
}

export async function loadOnboarding(supabase, userId) {
  const [application, documents, tax, agreement] = await Promise.all([
    fetchMyDriverApplication(supabase, userId),
    fetchMyDriverDocuments(supabase, userId),
    fetchMyTaxProfile(supabase, userId),
    fetchMyAgreement(supabase, userId),
  ])
  const ctx = complianceContext({ application, documents, tax, agreement })
  const stepId = resolveResumeStep(ctx) || firstIncompleteStepId(ctx)
  return {
    application,
    documents,
    tax,
    agreement,
    ctx,
    stepId,
    blockers: submissionBlockers(ctx),
    progress: progressSnapshot({ ...ctx, viewing: stepId }),
  }
}

export async function uploadDriverDocument(supabase, userId, docType, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!userId) throw new Error('Sign in required')
  if (!isRequiredDocType(docType)) throw new Error('Unknown document type')
  if (!file?.uri) throw new Error('Choose a file')
  if (file.size > MAX_BYTES) throw new Error('Each file must be 8MB or smaller')
  const mime = file.mimeType || ''
  const allowed = !mime || mime.startsWith('image/') || mime === 'application/pdf'
  if (!allowed) throw new Error('Upload a photo or PDF')

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${docType}/${Date.now()}.${ext}`
  const response = await fetch(file.uri)
  const bytes = await response.arrayBuffer()
  const { error: upErr } = await supabase.storage.from('driver-documents').upload(path, bytes, {
    contentType: mime || 'image/jpeg',
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
  return { doc_type: docType, storage_path: path }
}

async function saveDriverInfoDirect(supabase, user, payload) {
  const userId = user.id
  const { data: existing, error: existingErr } = await supabase
    .from('driver_applications')
    .select('onboarding_status')
    .eq('profile_id', userId)
    .maybeSingle()
  if (existingErr) throw new Error(existingErr.message)

  const nextStatus = statusAfterInfoSave(existing?.onboarding_status || null)
  const now = new Date().toISOString()
  const email = user.email || ''
  const isClemson = email.toLowerCase().endsWith('@clemson.edu') || email.toLowerCase().endsWith('@g.clemson.edu')
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

  const vehicle = await saveVehicle(supabase, userId, payload)
  await supabase.from('driver_status').upsert({
    driver_id: userId,
    online: false,
    updated_at: now,
  })
  return {
    ok: true,
    application: app,
    onboarding_status: nextStatus,
    vehicle,
    direct: true,
    message: 'Info saved. Upload your documents next. An admin must approve you before you can receive rides.',
  }
}

async function saveVehicle(supabase, userId, payload) {
  const vehFields = {
    make: payload.make,
    model: payload.model,
    color: payload.color || null,
    plate: payload.plate,
    seats: payload.seats || 4,
    is_tesla: Boolean(payload.isTesla),
    autonomous_capable: false,
    tier: payload.isTesla ? 'tesla_self_driving' : 'standard',
  }
  const { data: existingVeh } = await supabase.from('vehicles').select('id').eq('driver_id', userId).limit(1)
  const vehicle = existingVeh?.[0]
  if (!vehicle) {
    const { data, error } = await supabase.from('vehicles').insert({ driver_id: userId, ...vehFields }).select('*').single()
    if (error) throw new Error(error.message)
    return data
  }
  const { data, error } = await supabase.from('vehicles').update(vehFields).eq('id', vehicle.id).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

async function keepTeslaStub(supabase, userId, payload) {
  if (!payload?.isTesla || !supabase || !userId) return
  const { error } = await supabase
    .from('vehicles')
    .update({ autonomous_capable: false, tier: 'tesla_self_driving', is_tesla: true })
    .eq('driver_id', userId)
  if (error) console.warn('[tesla stub]', error.message)
}

export async function saveDriverInfo(supabase, user, payload) {
  if (!user?.id) throw new Error('Sign in required')
  try {
    const saved = await authedJson(supabase, '/api/driver?action=signup', { method: 'POST', body: payload })
    await keepTeslaStub(supabase, user.id, payload)
    return saved
  } catch (err) {
    if (!err.unavailable && !err.network) throw err
    const saved = await saveDriverInfoDirect(supabase, user, payload)
    await keepTeslaStub(supabase, user.id, payload)
    return saved
  }
}

export async function saveEmploymentVerification(supabase, userId, { backgroundAuthorized, category }) {
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

export async function saveDriverTaxInfo(supabase, { legalName, tin, taxClassification }) {
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

export async function signDriverAgreement(supabase, signatureName) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('sign_driver_agreement', {
    signature_name: signatureName,
  })
  if (error) throw new Error(error.message)
  return data
}

async function submitDriverReviewDirect(supabase, userId) {
  const bundle = await loadOnboarding(supabase, userId)
  if (bundle.blockers.length) {
    const error = new Error('Finish every required step before submitting for review.')
    error.payload = { missing: bundle.blockers }
    throw error
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('driver_applications')
    .update({
      onboarding_status: 'pending_review',
      status: legacyStatusFor('pending_review'),
      submitted_at: now,
    })
    .eq('profile_id', userId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return {
    ok: true,
    onboarding_status: 'pending_review',
    application: data,
    direct: true,
    message: 'Submitted for admin review. You cannot receive rides until you are approved.',
  }
}

export async function submitDriverReview(supabase, userId) {
  try {
    return await authedJson(supabase, '/api/driver?action=submit-review', { method: 'POST', body: {} })
  } catch (err) {
    if (!err.unavailable && !err.network) throw err
    if (!userId) throw err
    return submitDriverReviewDirect(supabase, userId)
  }
}
