/**
 * Driver background attestation.
 *
 * This is not a screening-vendor result. Status is only:
 *   pending       the attestation is unfinished
 *   authorized    the applicant consented and disclosed nothing that needs a look
 *   needs_review  the applicant consented and answered yes to a disclosure
 *
 * "Authorized" means consent is on file. It does not mean a background check
 * was ordered, completed, or cleared. A vendor result belongs in a future
 * column. See docs/BACKGROUND_CHECK.md.
 */

export const BACKGROUND_CHECK_STATUSES = ['pending', 'authorized', 'needs_review']

export const BACKGROUND_CONSENT_VERSION = 'background-auth-2026-10-07'

export const VENDOR_CHECK_NOT_PERFORMED =
  'No screening vendor has reported a result. Authorized means the applicant consented. It is not a completed background check.'

export const BACKGROUND_DISCLOSURES = [
  {
    id: 'conviction',
    prompt: 'In the last 7 years, have you been convicted of a felony or a misdemeanor other than a minor traffic violation?',
  },
  {
    id: 'license_action',
    prompt: 'Is your driver license currently suspended, revoked, expired, or restricted?',
  },
  {
    id: 'impaired_driving',
    prompt: 'In the last 7 years, have you been convicted of driving under the influence of alcohol or drugs?',
  },
]

const STATUS_SET = new Set(BACKGROUND_CHECK_STATUSES)

export function emptyDisclosures() {
  return { conviction: null, license_action: null, impaired_driving: null }
}

export function normalizeDisclosures(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const out = {}
  for (const question of BACKGROUND_DISCLOSURES) {
    const value = src[question.id]
    if (value === true || value === 'yes' || value === 'true') out[question.id] = true
    else if (value === false || value === 'no' || value === 'false') out[question.id] = false
    else out[question.id] = null
  }
  return out
}

function validSignedOn(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

/**
 * Derives the attestation status from what the applicant actually answered.
 * Never returns a vendor outcome such as clear, passed, or completed.
 */
export function assessBackgroundAttestation({
  legalName,
  disclosures,
  authorized,
  signatureName,
  signedOn,
} = {}) {
  const answers = normalizeDisclosures(disclosures)
  const name = String(legalName || '').trim()
  const signature = String(signatureName || '').trim()
  const date = String(signedOn || '').trim()
  const answered = BACKGROUND_DISCLOSURES.every((question) => answers[question.id] === true || answers[question.id] === false)
  let issue = null
  if (name.length < 2) issue = 'Enter your legal name.'
  else if (!answered) issue = 'Answer every background disclosure.'
  else if (authorized !== true) issue = 'Authorize the background check to continue.'
  else if (signature.length < 2) issue = 'Type your legal name to sign.'
  else if (!validSignedOn(date)) issue = 'Date the authorization.'

  if (issue) {
    return { status: 'pending', complete: false, disclosures: answers, vendorResult: null, issue }
  }

  const flagged = BACKGROUND_DISCLOSURES.some((question) => answers[question.id] === true)
  return {
    status: flagged ? 'needs_review' : 'authorized',
    complete: true,
    disclosures: answers,
    vendorResult: null,
    issue: null,
  }
}

/** Stored status only. A lone consent timestamp is still pending. */
export function storedBackgroundStatus(row) {
  const stored = row?.background_check_status
  if (STATUS_SET.has(stored)) return stored
  return 'pending'
}

export function backgroundAttestationComplete(status) {
  return status === 'authorized' || status === 'needs_review'
}

export function backgroundStatusLabel(status, row) {
  switch (status) {
    case 'authorized':
      return 'Authorized — consent on file, no vendor result'
    case 'needs_review':
      return 'Needs review — disclosure on file, no vendor result'
    case 'pending':
      if (row?.background_authorized_at && !STATUS_SET.has(row?.background_check_status)) {
        return 'Pending — consent checkbox only, not a background check'
      }
      return 'Pending — attestation not finished'
    default: {
      const unknown = status
      return `Pending — attestation not finished (${String(unknown || 'unknown')})`
    }
  }
}

export function backgroundGateFromApplication(application) {
  const backgroundStatus = storedBackgroundStatus(application)
  return {
    backgroundStatus,
    backgroundAuthorized: backgroundAttestationComplete(backgroundStatus),
    backgroundReviewAcknowledged: Boolean(application?.background_admin_reviewed_at),
  }
}

const BACKGROUND_EXTRA_KEYS = [
  'background_check_status',
  'background_legal_name',
  'background_signature_name',
  'background_signed_on',
  'background_consent_version',
  'background_disclosures',
  'background_admin_reviewed_at',
]

export function missingBackgroundColumns(error) {
  const message = String(error?.message || error || '')
  return /background_check_status|background_legal_name|background_disclosures|background_signature_name|background_signed_on|background_consent_version|background_admin_reviewed_at/i.test(message)
    && /schema cache|column|does not exist/i.test(message)
}

export function withoutBackgroundExtras(row) {
  if (!row) return row
  const next = { ...row }
  for (const key of BACKGROUND_EXTRA_KEYS) delete next[key]
  return next
}

/**
 * Row written when the attestation is complete.
 * needs_review must be stored. Falling back to a timestamp would hide the disclosure.
 */
export function backgroundAttestationWrite(input, now = new Date().toISOString()) {
  const assessment = assessBackgroundAttestation(input)
  if (!assessment.complete) return { error: assessment.issue, assessment, row: null }
  return {
    error: null,
    assessment,
    row: {
      background_authorized_at: now,
      background_check_status: assessment.status,
      background_legal_name: String(input.legalName || '').trim(),
      background_signature_name: String(input.signatureName || '').trim(),
      background_signed_on: String(input.signedOn || '').trim(),
      background_consent_version: BACKGROUND_CONSENT_VERSION,
      background_disclosures: assessment.disclosures,
    },
  }
}
