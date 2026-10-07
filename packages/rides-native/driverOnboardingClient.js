/**
 * Native driver onboarding. Same steps, RPCs, and /api/driver actions as the web app.
 * The TIN is sent only to save_driver_tax_info. Callers must not log it.
 */
import { authedJson } from './apiClient.js'
import { driverQuizError } from '../../shared/driverQuiz.js'
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
import { vehicleAccountErrors, withVehicleYear, writeVehicleWithYearFallback } from '../../shared/vehicleYear.js'
import { resolveSignupApplicantEmail, submittedApplicantEmail, writeDriverApplication } from '../../shared/applicantEmail.js'
import {
  BACKGROUND_CONSENT_VERSION,
  backgroundAttestationWrite,
  backgroundGateFromApplication,
  missingBackgroundColumns,
} from '../../shared/backgroundCheck.js'

export { vehicleAccountErrors }

export { driverQuizError } from '../../shared/driverQuiz.js'

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

export { BACKGROUND_CONSENT_VERSION }
export const WORK_ELIGIBILITY_VERSION = 'work-eligibility-2026-09-24'
export const W9_FORM_VERSION = 'w9-2026-09-24'

function registrationMatchFrom(documents) {
  const row = (documents || []).find((doc) => doc.doc_type === 'registration')
  return row?.match_status || null
}

export function agreementPlainText(html = IC_AGREEMENT_HTML) {
  if (html == null) return ''
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

function complianceContext({ application, documents, tax, agreement, email }) {
  return {
    status: application?.onboarding_status || null,
    uploaded: (documents || []).map((doc) => doc.doc_type),
    ...backgroundGateFromApplication(application),
    applicantEmail: submittedApplicantEmail(application, { email: email || application?.applicant_email }),
    workEligibilityAttested: Boolean(application?.work_eligibility_attested_at),
    workEligibilityCategory: application?.work_eligibility_category || null,
    taxSaved: Boolean(tax?.legal_name && /^[0-9]{4}$/.test(String(tax?.tin_last4 || ''))),
    agreementSigned: Boolean(agreement?.signed_at && agreement?.signature_name),
    agreementVersion: agreement?.agreement_version || null,
    registrationMatch: registrationMatchFrom(documents),
  }
}

const APPLICATION_COLUMNS = 'id, profile_id, onboarding_status, status, rejection_reason, review_note, submitted_at, reviewed_at, background_authorized_at, work_eligibility_attested_at, work_eligibility_category, is_student, has_car, has_insurance, wants_extra_money, attestation_accepted_at, applicant_email, background_check_status, background_legal_name, background_signature_name, background_signed_on, background_disclosures, background_admin_reviewed_at'
const APPLICATION_COLUMNS_BASIC = 'id, profile_id, onboarding_status, status, rejection_reason, review_note, submitted_at, reviewed_at, background_authorized_at, work_eligibility_attested_at, work_eligibility_category, is_student, has_car, has_insurance, wants_extra_money, attestation_accepted_at'

export async function fetchMyDriverApplication(supabase, userId) {
  if (!supabase || !userId) return null
  let result = await supabase
    .from('driver_applications')
    .select(APPLICATION_COLUMNS)
    .eq('profile_id', userId)
    .maybeSingle()
  if (result.error && /applicant_email|background_|schema cache|column/i.test(result.error.message || '')) {
    result = await supabase
      .from('driver_applications')
      .select(APPLICATION_COLUMNS_BASIC)
      .eq('profile_id', userId)
      .maybeSingle()
  }
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function fetchMyDriverDocuments(supabase, userId) {
  if (!supabase || !userId) return []
  const rich = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at, review_status, review_note, match_status')
    .eq('profile_id', userId)
  if (!rich.error) return rich.data || []
  if (!/review_status|match_status|review_note|schema cache/i.test(rich.error.message || '')) {
    throw new Error(rich.error.message)
  }
  const basic = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('profile_id', userId)
  if (basic.error) throw new Error(basic.error.message)
  return basic.data || []
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
  const application = await fetchMyDriverApplication(supabase, userId)
  if (application?.onboarding_status === 'approved') {
    const ctx = { status: 'approved' }
    return { application, documents: [], tax: null, agreement: null, ctx,
      stepId: 'review', blockers: [], progress: progressSnapshot(ctx) }
  }
  const [documents, tax, agreement] = await Promise.all([
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

async function upsertDriverDocument(supabase, row) {
  const first = await supabase.from('driver_documents').upsert(row, { onConflict: 'profile_id,doc_type' })
  if (!first.error) return
  if (!/review_status|match_status|review_note|schema cache/i.test(first.error.message || '')) {
    throw new Error(first.error.message)
  }
  const basic = {
    profile_id: row.profile_id,
    doc_type: row.doc_type,
    storage_path: row.storage_path,
    created_at: row.created_at,
  }
  const second = await supabase.from('driver_documents').upsert(basic, { onConflict: 'profile_id,doc_type' })
  if (second.error) throw new Error(second.error.message)
}

export async function uploadDriverDocument(supabase, userId, docType, file, meta = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!userId) throw new Error('Sign in required')
  if (!isRequiredDocType(docType)) throw new Error('Unknown document type')
  if (!file?.uri) throw new Error('Choose a file')
  if (file.size > MAX_BYTES) throw new Error('Each file must be 8MB or smaller')
  const mime = file.mimeType || ''
  const imageOnly = docType === 'license_front' || docType === 'license_back'
  const allowed = imageOnly
    ? mime.startsWith('image/')
    : !mime || mime.startsWith('image/') || mime === 'application/pdf'
  if (!allowed) throw new Error(imageOnly ? 'Upload a photo of the license.' : 'Upload a photo or PDF')

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

  await upsertDriverDocument(supabase, {
    profile_id: userId,
    doc_type: docType,
    storage_path: path,
    created_at: new Date().toISOString(),
    review_status: meta.reviewStatus || null,
    review_note: meta.reviewNote || null,
    match_status: meta.matchStatus || null,
  })

  if (previous?.storage_path && previous.storage_path !== path) {
    await supabase.storage.from('driver-documents').remove([previous.storage_path])
  }
  return { doc_type: docType, storage_path: path, bytes, reviewStatus: meta.reviewStatus || null, matchStatus: meta.matchStatus || null }
}

export async function recordFormSignature(supabase, userId, row) {
  if (!supabase || !userId) return null
  const payload = {
    profile_id: userId,
    form_id: row.formId,
    form_version: row.formVersion,
    signature_name: row.signatureName,
    signed_on: row.signedOn,
    signature_mark: row.signatureMark || null,
    signed_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('driver_form_signatures').upsert(payload, { onConflict: 'profile_id,form_id,form_version' })
  if (error && /driver_form_signatures|schema cache|relation/i.test(error.message || '')) return null
  if (error) throw new Error(error.message)
  return payload
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
  const email = resolveSignupApplicantEmail(payload, user)
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

  const savedApp = await writeDriverApplication(
    (row) => supabase
      .from('driver_applications')
      .upsert(row, { onConflict: 'profile_id' })
      .select('*')
      .single(),
    {
      profile_id: userId,
      is_student: payload.isStudent === true,
      has_car: true,
      has_insurance: true,
      wants_extra_money: payload.wantsExtraMoney === true,
      attestation_accepted_at: now,
      onboarding_status: nextStatus,
      status: legacyStatusFor(nextStatus),
    },
    email,
  )
  if (savedApp.error) throw new Error(savedApp.error.message)
  const app = savedApp.data

  const vehicle = await saveVehicle(supabase, userId, payload)
  if (nextStatus !== 'approved') await supabase.from('driver_status').upsert({
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
  const vehFields = withVehicleYear({
    make: payload.make,
    model: payload.model,
    color: payload.color || null,
    plate: payload.plate,
    seats: payload.seats || 4,
    service_class: payload.comfortClass ? 'comfort' : 'standard',
    autonomous_capable: false,
    tier: payload.comfortClass ? 'comfort' : 'standard',
  }, payload.year)
  const { data: existingVeh } = await supabase.from('vehicles').select('id').eq('driver_id', userId).limit(1)
  const vehicle = existingVeh?.[0]
  const saved = await writeVehicleWithYearFallback((fields) => {
    if (!vehicle) {
      return supabase.from('vehicles').insert({ driver_id: userId, ...fields }).select('*').single()
    }
    return supabase.from('vehicles').update(fields).eq('id', vehicle.id).select('*').single()
  }, vehFields)
  if (saved.error) throw new Error(saved.error.message)
  return saved.data
}

async function keepComfortStub(supabase, userId, payload) {
  if (!payload?.comfortClass || !supabase || !userId) return
  const { error } = await supabase
    .from('vehicles')
    .update({ autonomous_capable: false, tier: 'comfort', service_class: 'comfort' })
    .eq('driver_id', userId)
  if (error) console.warn('[comfort stub]', error.message)
}

export async function saveDriverInfo(supabase, user, payload) {
  if (!user?.id) throw new Error('Sign in required')
  const quizError = driverQuizError({
    hasCar: payload?.hasCar,
    hasInsurance: payload?.hasInsurance,
    attestation: payload?.attestationAccepted,
  })
  if (quizError) throw new Error(quizError)
  const applicantEmail = resolveSignupApplicantEmail(payload, user)
  if (!applicantEmail) throw new Error('A valid email is required.')
  const body = { ...payload, email: applicantEmail }
  try {
    const saved = await authedJson(supabase, '/api/driver?action=signup', { method: 'POST', body })
    await keepComfortStub(supabase, user.id, payload)
    return saved
  } catch (err) {
    if (!err.unavailable && !err.network) throw err
    const saved = await saveDriverInfoDirect(supabase, user, body)
    await keepComfortStub(supabase, user.id, payload)
    return saved
  }
}

export async function saveEmploymentVerification(supabase, userId, input) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!userId) throw new Error('Sign in required')
  const backgroundAuthorized = input?.backgroundAuthorized
  const category = input?.category
  if (!backgroundAuthorized) throw new Error('Sign the background-check authorization to continue.')
  if (!WORK_ELIGIBILITY_CATEGORIES.some((item) => item.id === category)) {
    throw new Error('Select your eligibility to work.')
  }
  const signatureName = String(input?.signatureName || '').trim()
  if (signatureName.length < 2) throw new Error('Type your legal name to sign.')
  const signedOn = input?.signedOn || new Date().toISOString().slice(0, 10)
  const written = backgroundAttestationWrite({
    legalName: input?.legalName || signatureName,
    disclosures: input?.disclosures,
    authorized: true,
    signatureName,
    signedOn,
  })
  if (written.error) throw new Error(written.error)
  const now = new Date().toISOString()
  const full = {
    ...written.row,
    background_authorized_at: now,
    work_eligibility_attested_at: now,
    work_eligibility_category: category,
    work_eligibility_signature_name: signatureName,
    work_eligibility_signed_on: signedOn,
    work_eligibility_consent_version: WORK_ELIGIBILITY_VERSION,
  }
  let saved = await supabase
    .from('driver_applications')
    .update(full)
    .eq('profile_id', userId)
    .select('background_authorized_at, work_eligibility_attested_at, work_eligibility_category, background_check_status')
    .single()
  if (saved.error && (missingBackgroundColumns(saved.error) || /column|schema cache/i.test(saved.error.message || ''))) {
    if (written.assessment.status === 'needs_review') {
      throw new Error('This disclosure needs admin review. Apply the background attestation migration before continuing.')
    }
    saved = await supabase
      .from('driver_applications')
      .update({
        background_authorized_at: now,
        work_eligibility_attested_at: now,
        work_eligibility_category: category,
      })
      .eq('profile_id', userId)
      .select('background_authorized_at, work_eligibility_attested_at, work_eligibility_category')
      .single()
  }
  if (saved.error) throw new Error(saved.error.message)
  saved.data = {
    ...saved.data,
    background_check_status: written.assessment.status,
    background_disclosures: written.assessment.disclosures,
    vendor_result: null,
  }
  await recordFormSignature(supabase, userId, {
    formId: 'background_authorization',
    formVersion: BACKGROUND_CONSENT_VERSION,
    signatureName,
    signedOn,
    signatureMark: input?.signatureMark || null,
  })
  await recordFormSignature(supabase, userId, {
    formId: 'work_eligibility',
    formVersion: WORK_ELIGIBILITY_VERSION,
    signatureName,
    signedOn,
    signatureMark: input?.signatureMark || null,
  })
  return saved.data
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

export async function saveDriverW9(supabase, userId, payload) {
  const digits = String(payload.tin || '').replace(/\D/g, '')
  if (digits.length !== 9) {
    if (!userId || String(payload.signatureName || '').trim().length < 2) {
      throw new Error('Sign the W-9.')
    }
    await recordFormSignature(supabase, userId, {
      formId: 'w9',
      formVersion: W9_FORM_VERSION,
      signatureName: payload.signatureName,
      signedOn: payload.signedOn,
      signatureMark: payload.signatureMark || null,
    })
    return { legal_name: payload.legalName }
  }
  if (supabase) {
    const rpc = await supabase.rpc('save_driver_w9', {
      legal_name: payload.legalName,
      tin: String(payload.tin || '').replace(/\D/g, ''),
      tax_classification: payload.taxClassification,
      business_name: payload.businessName || null,
      address_line: payload.address || null,
      signature_name: payload.signatureName || null,
      signed_on: payload.signedOn || null,
    })
    if (!rpc.error) {
      if (userId) {
        await recordFormSignature(supabase, userId, {
          formId: 'w9',
          formVersion: W9_FORM_VERSION,
          signatureName: payload.signatureName,
          signedOn: payload.signedOn,
          signatureMark: payload.signatureMark || null,
        })
      }
      const row = rpc.data && typeof rpc.data === 'object' ? rpc.data : {}
      return {
        legal_name: row.legal_name || payload.legalName,
        tin_last4: row.tin_last4,
        tax_classification: row.tax_classification || payload.taxClassification,
      }
    }
    if (!/save_driver_w9|schema cache|function|PGRST202/i.test(rpc.error.message || '')) {
      throw new Error(rpc.error.message)
    }
  }
  const saved = await saveDriverTaxInfo(supabase, payload)
  if (supabase && userId) {
    const extra = {
      business_name: payload.businessName || null,
      address_line: payload.address || null,
      w9_signature_name: payload.signatureName || null,
      w9_signed_on: payload.signedOn || null,
      w9_version: W9_FORM_VERSION,
    }
    const extraSave = await supabase.from('driver_tax_info').update(extra).eq('profile_id', userId)
    if (extraSave.error && !/column|schema cache|permission|policy/i.test(extraSave.error.message || '')) {
      throw new Error(extraSave.error.message)
    }
    await recordFormSignature(supabase, userId, {
      formId: 'w9',
      formVersion: W9_FORM_VERSION,
      signatureName: payload.signatureName,
      signedOn: payload.signedOn,
      signatureMark: payload.signatureMark || null,
    })
  }
  return saved
}

export async function signDriverAgreement(supabase, signatureName, extras = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('sign_driver_agreement', {
    signature_name: signatureName,
  })
  if (error) throw new Error(error.message)
  const userId = data?.signer_user_id || extras.userId || null
  if (userId) {
    await recordFormSignature(supabase, userId, {
      formId: 'ic_agreement',
      formVersion: IC_AGREEMENT_VERSION,
      signatureName,
      signedOn: extras.signedOn || new Date().toISOString().slice(0, 10),
      signatureMark: extras.signatureMark || { typedName: signatureName },
    })
  }
  return data
}

async function submitDriverReviewDirect(supabase, userId) {
  const bundle = await loadOnboarding(supabase, userId)
  if (bundle.application?.onboarding_status === 'approved') {
    return { ok: true, onboarding_status: 'approved', application: bundle.application, direct: true, message: 'Already approved.' }
  }
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
    .neq('onboarding_status', 'approved')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) {
    const current = await fetchMyDriverApplication(supabase, userId)
    if (current?.onboarding_status === 'approved') {
      return { ok: true, onboarding_status: 'approved', application: current, direct: true, message: 'Already approved.' }
    }
    throw new Error('Application changed. Refresh and try again.')
  }
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
