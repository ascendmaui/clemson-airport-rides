/** Driver approval gate — shared by the Vite client, Vercel API, and tests. */

import { IC_AGREEMENT_VERSION } from './icAgreement.js'
import { isAdminIdentity } from './adminAccess.js'
import { VEHICLE_YEAR_MIN, maxVehicleYear, parseVehicleYear } from './vehicleYear.js'

export { IC_AGREEMENT_HTML, IC_AGREEMENT_TITLE, IC_AGREEMENT_VERSION } from './icAgreement.js'
export { isAdminIdentity }

export const ONBOARDING_STATUSES = [
  'pending_info',
  'pending_docs',
  'pending_review',
  'approved',
  'rejected',
]

/**
 * Required uploads. Add a row here and seed the same id in
 * supabase/driver_onboarding_compliance.sql (`driver_required_documents`).
 * `stepId` must match an ONBOARDING_STEPS id. The progress bar and admin
 * checklist are derived from this list — do not hardcode a parallel array.
 */
export const REQUIRED_DOCUMENTS = [
  { id: 'license_front', label: 'Driver license — front', hint: 'Full front of your license, unobstructed', stepId: 'license' },
  { id: 'license_back', label: 'Driver license — back', hint: 'Full back of your license', stepId: 'license' },
  { id: 'insurance_front', label: 'Insurance card — front', hint: 'Current auto policy card', stepId: 'insurance' },
  { id: 'insurance_back', label: 'Insurance card — back', hint: 'Back of the insurance card', stepId: 'insurance' },
  { id: 'registration', label: 'Car registration', hint: 'Current registration for the vehicle you will drive', stepId: 'registration' },
  { id: 'car_front', label: 'Car — front', hint: 'Straight-on photo of the front', stepId: 'car' },
  { id: 'car_back', label: 'Car — back', hint: 'Rear photo so the plate and body match', stepId: 'car' },
  { id: 'car_left', label: 'Car — left side', hint: 'Driver side, full side-to-side', stepId: 'car' },
  { id: 'car_right', label: 'Car — right side', hint: 'Passenger side, full side-to-side', stepId: 'car' },
]

export const REQUIRED_DOC_IDS = REQUIRED_DOCUMENTS.map((doc) => doc.id)

export const WORK_ELIGIBILITY_CATEGORIES = [
  { id: 'citizen', label: 'U.S. citizen' },
  { id: 'noncitizen_national', label: 'Noncitizen national' },
  { id: 'permanent_resident', label: 'Lawful permanent resident' },
  { id: 'alien_authorized', label: 'Alien authorized to work' },
]

export const TAX_CLASSIFICATIONS = [
  { id: 'individual', label: 'Individual / sole proprietor' },
  { id: 'llc', label: 'LLC' },
  { id: 'c_corp', label: 'C corporation' },
  { id: 's_corp', label: 'S corporation' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'other', label: 'Other' },
]

/** Screen order. Document steps pick up every REQUIRED_DOCUMENTS row with that stepId. */
const ONBOARDING_STEPS = [
  { id: 'account', label: 'Account', kind: 'account' },
  { id: 'license', label: 'License', kind: 'documents' },
  { id: 'insurance', label: 'Insurance', kind: 'documents' },
  { id: 'registration', label: 'Registration', kind: 'documents' },
  { id: 'car', label: 'Car photos', kind: 'documents' },
  { id: 'employment', label: 'Employment', kind: 'employment' },
  { id: 'w9', label: 'W-9', kind: 'tax' },
  { id: 'agreement', label: 'Agreement', kind: 'agreement' },
  { id: 'review', label: 'Submit', kind: 'review' },
]

/** Multi-screen driver application. Order is the progress bar. */
export const ONBOARDING_FLOW = ONBOARDING_STEPS.map((step) => ({
  ...step,
  docIds: REQUIRED_DOCUMENTS.filter((doc) => doc.stepId === step.id).map((doc) => doc.id),
}))

export function flowStep(stepId) {
  return ONBOARDING_FLOW.find((step) => step.id === stepId) || null
}

export function accountInfoSaved(status) {
  switch (status) {
    case 'pending_docs':
    case 'pending_review':
    case 'approved':
    case 'rejected':
      return true
    case 'pending_info':
    case null:
    case undefined:
      return false
    default: {
      const unknown = status
      return unknown === 'pending_docs'
    }
  }
}

function docsComplete(step, uploaded) {
  const have = new Set(uploaded || [])
  return (step.docIds || []).every((id) => have.has(id))
}

export function stepIsComplete(stepId, ctx = {}) {
  const step = flowStep(stepId)
  if (!step) return false
  const docsDone = docsComplete(step, ctx.uploaded)
  switch (step.kind) {
    case 'account':
      return accountInfoSaved(ctx.status)
    case 'documents':
      return docsDone && (stepId !== 'registration' || !['mismatch', 'unreadable'].includes(ctx.registrationMatch))
    case 'employment':
      return docsDone
        && Boolean(ctx.backgroundAuthorized)
        && Boolean(ctx.workEligibilityAttested)
        && Boolean(ctx.workEligibilityCategory)
    case 'tax':
      return docsDone && Boolean(ctx.taxSaved)
    case 'agreement':
      return agreementStepDone(ctx)
    case 'review':
      return ctx.status === 'pending_review' || ctx.status === 'approved'
    default: {
      const unknown = step.kind
      throw new Error(`Unknown onboarding step kind: ${unknown}`)
    }
  }
}

export function firstIncompleteStepId(ctx = {}) {
  if (ctx.status === 'approved') return 'review'
  for (const step of ONBOARDING_FLOW) {
    if (!stepIsComplete(step.id, ctx)) return step.id
  }
  return 'review'
}

/**
 * Resume a saved screen without skipping unfinished work.
 * Approved drivers always land on the last step; incomplete applicants resume work.
 */
export function canOpenStep(stepId, ctx = {}) {
  if (ctx.status === 'pending_review' || ctx.status === 'approved' || ctx.status === 'rejected') return true
  const first = firstIncompleteStepId(ctx)
  const idx = ONBOARDING_FLOW.findIndex((step) => step.id === stepId)
  const firstIdx = ONBOARDING_FLOW.findIndex((step) => step.id === first)
  return idx >= 0 && idx <= firstIdx
}

export function resolveResumeStep(ctx = {}) {
  if (ctx.status === 'approved') return 'review'
  const first = firstIncompleteStepId(ctx)
  if (!ctx.preferred) return first
  const prefIdx = ONBOARDING_FLOW.findIndex((step) => step.id === ctx.preferred)
  const firstIdx = ONBOARDING_FLOW.findIndex((step) => step.id === first)
  if (prefIdx < 0) return first
  if (prefIdx > firstIdx) return first
  return ctx.preferred
}

export function adjacentStep(stepId, direction) {
  const idx = ONBOARDING_FLOW.findIndex((step) => step.id === stepId)
  if (idx < 0) return null
  return ONBOARDING_FLOW[idx + direction] || null
}

function stepFraction(step, ctx) {
  const have = new Set(ctx.uploaded || [])
  const docDone = (step.docIds || []).filter((id) => have.has(id)).length
  const docCount = (step.docIds || []).length
  switch (step.kind) {
    case 'account':
      return accountInfoSaved(ctx.status) ? 1 : 0
    case 'documents':
      return docCount ? docDone / docCount : 0
    case 'employment': {
      const parts = docCount + 2
      const done = docDone
        + (ctx.backgroundAuthorized ? 1 : 0)
        + (ctx.workEligibilityAttested && ctx.workEligibilityCategory ? 1 : 0)
      return done / parts
    }
    case 'tax': {
      const parts = docCount + 1
      return (docDone + (ctx.taxSaved ? 1 : 0)) / parts
    }
    case 'agreement':
      return agreementStepDone(ctx) ? 1 : 0
    case 'review':
      return 0
    default: {
      const unknown = step.kind
      throw new Error(`Unknown onboarding step kind: ${unknown}`)
    }
  }
}

/** Orange fill amount: partial credit inside the current step, 100 after submit. */
export function progressSnapshot(ctx = {}) {
  const { status, viewing } = ctx
  const total = ONBOARDING_FLOW.length
  const viewIndex = Math.max(0, ONBOARDING_FLOW.findIndex((step) => step.id === viewing))
  if (status === 'approved' || (status === 'pending_review' && submissionBlockers(ctx).length === 0)) {
    const current = ONBOARDING_FLOW[viewIndex]
    const onReview = !viewing || viewing === 'review'
    return {
      total,
      index: onReview ? total - 1 : viewIndex,
      stepNumber: onReview ? total : viewIndex + 1,
      percent: 100,
      label: onReview ? (status === 'approved' ? 'Approved' : 'Pending review') : (current?.label || 'Submit'),
      submitted: true,
    }
  }
  let units = 0
  for (const step of ONBOARDING_FLOW) {
    units += stepFraction(step, ctx)
  }
  const percent = Math.max(0, Math.min(100, Math.round((units / total) * 100)))
  const current = ONBOARDING_FLOW[viewIndex]
  return {
    total,
    index: viewIndex,
    stepNumber: viewIndex + 1,
    percent,
    label: current?.label || 'Account',
    submitted: false,
  }
}

export const EMAIL_TODO =
  'TODO: set RESEND_API_KEY, RESEND_FROM (verified domain), and ADMIN_NOTIFY_EMAIL to email the admin when a driver applies. The in-app admin dashboard at #/admin lists each application with the email submitted on it.'

const DOC_ID_SET = new Set(REQUIRED_DOC_IDS)

export function isRequiredDocType(docType) {
  return DOC_ID_SET.has(docType)
}

export function missingDocuments(uploadedTypes) {
  const have = new Set(uploadedTypes || [])
  return REQUIRED_DOC_IDS.filter((id) => !have.has(id))
}

/** Last-4 display only. A full TIN (or anything other than 4 digits) renders blank. */
export function displayTinLast4(value) {
  const last4 = String(value ?? '')
  if (!/^[0-9]{4}$/.test(last4)) return ''
  return `••••${last4}`
}

/**
 * Why the W-9 Continue button is disabled.
 * A typed legal name, tax classification, and 9-digit TIN are enough.
 * There is no W-9 file in REQUIRED_DOCUMENTS, and the server gate is taxSaved
 * (legal name plus TIN last-4), not an uploaded form.
 */
export function w9ContinueIssue({ legalName, taxClass, tin, taxSaved = false } = {}) {
  if (String(legalName || '').trim().length < 2) {
    return 'Enter your legal name as it appears on your W-9.'
  }
  if (!TAX_CLASSIFICATIONS.some((item) => item.id === taxClass)) {
    return 'Select a federal tax classification.'
  }
  if (taxSaved) return null
  const digits = String(tin || '').replace(/\D/g, '')
  if (digits.length !== 9) {
    return 'Enter a 9-digit TIN. Only the last four digits are shown after you save.'
  }
  return null
}

export function submissionBlockers(ctx = {}) {
  const blockers = missingDocuments(ctx.uploaded).map((id) => `doc:${id}`)
  if (ctx.registrationMatch === 'mismatch' || ctx.registrationMatch === 'unreadable') {
    blockers.push('registration_match')
  }
  if (!ctx.backgroundAuthorized) blockers.push('background_authorization_attestation')
  if (!ctx.workEligibilityAttested || !ctx.workEligibilityCategory) blockers.push('work_eligibility_attestation')
  if (!ctx.taxSaved) blockers.push('w9_tax_info')
  return blockers
}

function agreementStepDone(ctx) {
  return Boolean(ctx.taxSaved)
    || (Boolean(ctx.agreementSigned) && ctx.agreementVersion === IC_AGREEMENT_VERSION)
}

function agreementSatisfied(ctx) {
  const signedCurrent = Boolean(ctx.agreementSigned) && ctx.agreementVersion === IC_AGREEMENT_VERSION
  if (!signedCurrent) return false
  if (ctx.packetHash && ctx.agreementSha256 !== ctx.packetHash) return false
  return true
}

/** Approval still requires the current signed text. Submit does not. */
export function approvalBlockers(ctx = {}) {
  const blockers = submissionBlockers(ctx)
  if (!agreementSatisfied(ctx)) blockers.push('ic_agreement')
  return blockers
}

export function blockerLabel(code) {
  if (String(code).startsWith('doc:')) {
    const id = String(code).slice(4)
    return REQUIRED_DOCUMENTS.find((doc) => doc.id === id)?.label || id
  }
  switch (code) {
    case 'registration_match':
      return 'Registration that matches the vehicle you entered'
    case 'background_authorization_attestation':
      return 'Signed background-check authorization'
    case 'work_eligibility_attestation':
      return 'Work-eligibility attestation'
    case 'w9_tax_info':
      return 'W-9 legal name and TIN'
    case 'ic_agreement':
      return 'Signed independent contractor agreement'
    default: {
      const unknown = code
      return String(unknown)
    }
  }
}

/**
 * Next action when the vehicle year, the W-9, or the contractor agreement is open.
 * Year wins, then W-9, then the unsigned agreement, so the hint names one step.
 * An omitted vehicleYear or agreement field means "not loaded", not "missing".
 * taxSaved counts as pending only when it is false.
 * These hints do not add approval blockers. Submit stays allowed when the only gap is the signature.
 */
export function vehicleYearNextStepHint(now = new Date()) {
  const max = maxVehicleYear(now)
  return `Enter the vehicle year (${VEHICLE_YEAR_MIN} to ${max}) on Account, then continue to License.`
}

export function w9NextStepHint() {
  return 'Finish the W-9 with your legal name and 9-digit TIN, then continue to Agreement.'
}

export function agreementUnsignedNextStepHint() {
  return 'The contractor agreement is unsigned. Continue to Submit. You sign the copy an admin emails you, and approval waits on that signature.'
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

function vehicleYearMissing(ctx, now) {
  if (!hasOwn(ctx, 'vehicleYear')) return false
  return parseVehicleYear(ctx.vehicleYear, now) == null
}

function agreementFieldsPresent(ctx) {
  return hasOwn(ctx, 'agreementSigned') || hasOwn(ctx, 'agreementVersion') || hasOwn(ctx, 'agreementSha256')
}

export function nextStepHint(ctx = {}, now = new Date()) {
  if (vehicleYearMissing(ctx, now)) return vehicleYearNextStepHint(now)
  if (ctx.taxSaved === false) return w9NextStepHint()
  if (agreementFieldsPresent(ctx) && !agreementSatisfied(ctx)) return agreementUnsignedNextStepHint()
  return null
}

export function canReceiveRides(onboardingStatus) {
  return onboardingStatus === 'approved'
}

export function legacyStatusFor(onboardingStatus) {
  switch (onboardingStatus) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'pending_info':
    case 'pending_docs':
    case 'pending_review':
      return 'pending'
    default: {
      const unknown = onboardingStatus
      throw new Error(`Unknown onboarding status: ${unknown}`)
    }
  }
}

/** Info save never approves a driver. Approved applications stay approved. */
export function statusAfterInfoSave(current) {
  switch (current) {
    case 'approved':
      return 'approved'
    case 'pending_review':
      return 'pending_review'
    case 'pending_info':
    case 'pending_docs':
    case 'rejected':
    case null:
    case undefined:
      return 'pending_docs'
    default: {
      const unknown = current
      throw new Error(`Unknown onboarding status: ${unknown}`)
    }
  }
}

export function onboardingLabel(status) {
  switch (status) {
    case 'pending_info':
      return 'Finish your info'
    case 'pending_docs':
      return 'Waiting on applicant — continue application'
    case 'pending_review':
      return 'Waiting for admin review'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Needs changes'
    case null:
    case undefined:
      return 'Not started'
    default: {
      const unknown = status
      return String(unknown)
    }
  }
}
