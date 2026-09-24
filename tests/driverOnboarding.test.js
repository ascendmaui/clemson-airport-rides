import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { IC_AGREEMENT_HTML, IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import {
  ADMIN_EMAIL,
  ONBOARDING_FLOW,
  REQUIRED_DOC_IDS,
  canReceiveRides,
  displayTinLast4,
  firstIncompleteStepId,
  isAdminIdentity,
  legacyStatusFor,
  missingDocuments,
  progressSnapshot,
  resolveResumeStep,
  statusAfterInfoSave,
  blockerLabel,
  submissionBlockers,
} from '../shared/driverOnboarding.js'

test('new drivers are not approved by an info save', () => {
  assert.equal(statusAfterInfoSave(null), 'pending_docs')
  assert.equal(statusAfterInfoSave(undefined), 'pending_docs')
  assert.equal(statusAfterInfoSave('pending_info'), 'pending_docs')
  assert.equal(statusAfterInfoSave('rejected'), 'pending_docs')
  assert.equal(statusAfterInfoSave('pending_docs'), 'pending_docs')
  assert.notEqual(statusAfterInfoSave('pending_info'), 'approved')
})

test('info edits do not knock an approved or in-review driver backward', () => {
  assert.equal(statusAfterInfoSave('approved'), 'approved')
  assert.equal(statusAfterInfoSave('pending_review'), 'pending_review')
})

test('only approved drivers can receive rides', () => {
  for (const status of ['pending_info', 'pending_docs', 'pending_review', 'rejected', null, undefined]) {
    assert.equal(canReceiveRides(status), false, String(status))
  }
  assert.equal(canReceiveRides('approved'), true)
})

test('legacy status column stays inside pending|approved|rejected', () => {
  assert.equal(legacyStatusFor('pending_docs'), 'pending')
  assert.equal(legacyStatusFor('pending_review'), 'pending')
  assert.equal(legacyStatusFor('approved'), 'approved')
  assert.equal(legacyStatusFor('rejected'), 'rejected')
})

test('required file uploads are license, insurance, registration, and car photos', () => {
  assert.equal(REQUIRED_DOC_IDS.includes('background_authorization'), false)
  assert.equal(REQUIRED_DOC_IDS.includes('work_eligibility'), false)
  assert.equal(REQUIRED_DOC_IDS.includes('w9'), false)
  const owned = ONBOARDING_FLOW.flatMap((step) => step.docIds || [])
  assert.deepEqual([...owned].sort(), [...REQUIRED_DOC_IDS].sort())
  assert.deepEqual(missingDocuments([]), REQUIRED_DOC_IDS)
  assert.deepEqual(missingDocuments(REQUIRED_DOC_IDS), [])
  assert.deepEqual(missingDocuments(REQUIRED_DOC_IDS.filter((id) => id !== 'car_right')), ['car_right'])
})

test('progress bar includes every required step and does not skip unfinished work', () => {
  assert.deepEqual(ONBOARDING_FLOW.map((step) => step.label), [
    'Account',
    'License',
    'Insurance',
    'Registration',
    'Car photos',
    'Employment',
    'W-9',
    'Agreement',
    'Submit',
  ])
  assert.equal(firstIncompleteStepId({ status: null, uploaded: [] }), 'account')
  const afterAccount = firstIncompleteStepId({ status: 'pending_docs', uploaded: [] })
  assert.equal(afterAccount, 'license')
  const licenseOnly = ['license_front', 'license_back']
  assert.equal(firstIncompleteStepId({ status: 'pending_docs', uploaded: licenseOnly }), 'insurance')
  assert.equal(
    resolveResumeStep({ status: 'pending_docs', uploaded: licenseOnly, preferred: 'car' }),
    'insurance',
  )
  assert.equal(
    resolveResumeStep({ status: 'pending_docs', uploaded: licenseOnly, preferred: 'account' }),
    'account',
  )
  assert.equal(resolveResumeStep({ status: 'pending_review', uploaded: REQUIRED_DOC_IDS }), 'review')
})

test('progress percent fills as documents land and hits 100 at review', () => {
  const start = progressSnapshot({ status: null, uploaded: [], viewing: 'account' })
  assert.equal(start.stepNumber, 1)
  assert.equal(start.total, ONBOARDING_FLOW.length)
  assert.equal(start.percent, 0)

  const accountDone = progressSnapshot({ status: 'pending_docs', uploaded: [], viewing: 'license' })
  assert.equal(accountDone.stepNumber, 2)
  assert.equal(accountDone.percent, 11)

  const halfLicense = progressSnapshot({
    status: 'pending_docs',
    uploaded: ['license_front'],
    viewing: 'license',
  })
  assert.ok(halfLicense.percent > accountDone.percent)
  assert.ok(halfLicense.percent < 34)

  const submitted = progressSnapshot({
    status: 'pending_review',
    uploaded: REQUIRED_DOC_IDS,
    viewing: 'review',
  })
  assert.equal(submitted.percent, 100)
  assert.equal(submitted.stepNumber, ONBOARDING_FLOW.length)
  assert.equal(submitted.label, 'Pending review')
})

test('a flagged registration blocks submit until it matches the vehicle', () => {
  const blocked = submissionBlockers({
    status: 'pending_docs',
    uploaded: REQUIRED_DOC_IDS,
    registrationMatch: 'mismatch',
    backgroundAuthorized: true,
    workEligibilityAttested: true,
    workEligibilityCategory: 'citizen',
    taxSaved: true,
    agreementSigned: true,
    agreementVersion: IC_AGREEMENT_VERSION,
  })
  assert.ok(blocked.includes('registration_match'))
  assert.match(blockerLabel('registration_match'), /Registration/)
})

test('submit stays blocked until employment, W-9, and the signed agreement exist', () => {
  const readyDocs = {
    status: 'pending_docs',
    uploaded: REQUIRED_DOC_IDS,
    backgroundAuthorized: true,
    workEligibilityAttested: true,
    workEligibilityCategory: 'citizen',
    taxSaved: true,
    agreementSigned: true,
    agreementVersion: IC_AGREEMENT_VERSION,
  }
  assert.deepEqual(submissionBlockers(readyDocs), [])
  assert.equal(firstIncompleteStepId(readyDocs), 'review')

  const missingSignature = { ...readyDocs, agreementSigned: false, agreementVersion: null }
  assert.deepEqual(submissionBlockers(missingSignature), ['ic_agreement'])
  assert.equal(firstIncompleteStepId(missingSignature), 'agreement')
  assert.equal(resolveResumeStep({ ...missingSignature, preferred: 'review' }), 'agreement')

  const missingTax = { ...readyDocs, taxSaved: false }
  assert.ok(submissionBlockers(missingTax).includes('w9_tax_info'))
  assert.equal(firstIncompleteStepId(missingTax), 'w9')

  const missingWork = { ...readyDocs, workEligibilityAttested: false }
  assert.ok(submissionBlockers(missingWork).includes('work_eligibility_attestation'))
  assert.equal(firstIncompleteStepId(missingWork), 'employment')
})

test('TIN display is last-4 only', () => {
  assert.equal(displayTinLast4('6789'), '••••6789')
  assert.equal(displayTinLast4('123456789'), '')
  assert.equal(displayTinLast4('12'), '')
  assert.equal(displayTinLast4(null), '')
})

test('compliance migration stores the exact agreement and every required doc type', () => {
  const sql = readFileSync(new URL('../supabase/driver_onboarding_compliance.sql', import.meta.url), 'utf8')
  for (const id of REQUIRED_DOC_IDS) {
    assert.ok(sql.includes(`'${id}'`), id)
  }
  const parts = sql.split('$html$')
  assert.equal(parts[1], IC_AGREEMENT_HTML)
  assert.equal(parts[3], IC_AGREEMENT_HTML)
  assert.ok(sql.includes(IC_AGREEMENT_VERSION))
  assert.ok(sql.includes('driver_tax_secrets'))
  assert.equal(sql.includes('return jsonb_build_object(\n    \'legal_name\', cleaned_name,\n    \'tin_last4\', last4,'), true)
  const hash = createHash('sha256').update(IC_AGREEMENT_HTML, 'utf8').digest('hex')
  assert.equal(hash.length, 64)
  assert.equal(sql.includes(hash), false)
})

test('admin is john@gmail.com, is_admin, or admin/ops role — not a copied profile email', () => {
  assert.equal(isAdminIdentity({ jwtEmail: ADMIN_EMAIL }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'JOHN@gmail.com' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', isAdmin: true }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'admin' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'ops' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'driver' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu' }), false)
})
