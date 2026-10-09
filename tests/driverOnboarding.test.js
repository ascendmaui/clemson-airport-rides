import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { IC_AGREEMENT_HTML, IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import {
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
  approvalBlockers,
  blockerLabel,
  submissionBlockers,
  w9ContinueIssue,
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
  assert.equal(resolveResumeStep({ status: 'pending_review', uploaded: REQUIRED_DOC_IDS }), 'employment')
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
    backgroundAuthorized: true,
    workEligibilityAttested: true,
    workEligibilityCategory: 'citizen',
    taxSaved: true,
    agreementSigned: true,
    agreementVersion: IC_AGREEMENT_VERSION,
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

test('submit does not require a signature; approval does', () => {
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
  assert.deepEqual(submissionBlockers(missingSignature), [])
  assert.deepEqual(approvalBlockers(missingSignature), ['ic_agreement'])
  assert.equal(firstIncompleteStepId(missingSignature), 'review')
  assert.equal(resolveResumeStep({ ...missingSignature, preferred: 'review' }), 'review')

  const wrongVersion = { ...readyDocs, agreementVersion: 'old-version' }
  assert.deepEqual(approvalBlockers(wrongVersion), ['ic_agreement'])
  const hashMismatch = { ...readyDocs, agreementSha256: 'signed', packetHash: 'packet' }
  assert.deepEqual(approvalBlockers(hashMismatch), ['ic_agreement'])
  const hashMatch = { ...readyDocs, agreementSha256: 'abc', packetHash: 'abc' }
  assert.deepEqual(approvalBlockers(hashMatch), [])

  const missingTax = { ...readyDocs, taxSaved: false }
  assert.ok(submissionBlockers(missingTax).includes('w9_tax_info'))
  assert.equal(firstIncompleteStepId(missingTax), 'w9')

  const missingWork = { ...readyDocs, workEligibilityAttested: false }
  assert.ok(submissionBlockers(missingWork).includes('work_eligibility_attestation'))
  assert.equal(firstIncompleteStepId(missingWork), 'employment')
})

test('W-9 continue follows the typed tax record, not a file the step cannot upload', () => {
  assert.equal(REQUIRED_DOC_IDS.includes('w9'), false)
  assert.equal(w9ContinueIssue({
    legalName: 'Ada Lovelace',
    taxClass: 'individual',
    tin: '123-45-6789',
  }), null)
  assert.match(
    w9ContinueIssue({ legalName: 'A', taxClass: 'individual', tin: '123456789' }),
    /legal name/i,
  )
  assert.match(
    w9ContinueIssue({ legalName: 'Ada Lovelace', taxClass: 'nope', tin: '123456789' }),
    /classification/i,
  )
  assert.match(
    w9ContinueIssue({ legalName: 'Ada Lovelace', taxClass: 'individual', tin: '1234' }),
    /9-digit TIN/,
  )
  assert.equal(w9ContinueIssue({
    legalName: 'Ada Lovelace',
    taxClass: 'individual',
    tin: '',
    taxSaved: true,
  }), null)

  const savedTax = {
    status: 'pending_docs',
    uploaded: REQUIRED_DOC_IDS,
    backgroundAuthorized: true,
    workEligibilityAttested: true,
    workEligibilityCategory: 'citizen',
    taxSaved: true,
    agreementSigned: true,
    agreementVersion: IC_AGREEMENT_VERSION,
  }
  assert.equal(submissionBlockers(savedTax).includes('doc:w9'), false)
  assert.equal(submissionBlockers(savedTax).includes('w9_tax_info'), false)
  assert.ok(submissionBlockers({ ...savedTax, taxSaved: false }).includes('w9_tax_info'))

  const screen = readFileSync(new URL('../src/screens/DriverOnboarding.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(screen, /w9DocReady|uploaded\.includes\('w9'\)/)
  assert.match(screen, /w9ContinueIssue/)
  assert.match(screen, /id="w9-continue-reason"/)
  assert.match(screen, /You do not upload a file/)
})

test('TIN display is last-4 only', () => {
  assert.equal(displayTinLast4('6789'), '••••6789')
  assert.equal(displayTinLast4('123456789'), '')
  assert.equal(displayTinLast4('12'), '')
  assert.equal(displayTinLast4(null), '')
})

test('compliance seed no longer rewrites agreement HTML and still lists required docs', () => {
  const sql = readFileSync(new URL('../supabase/driver_onboarding_compliance.sql', import.meta.url), 'utf8')
  for (const id of REQUIRED_DOC_IDS) {
    assert.ok(sql.includes(`'${id}'`), id)
  }
  assert.equal(sql.includes('$html$'), false)
  assert.equal(sql.includes('body_html = excluded.body_html'), false)
  assert.match(sql, /do not re-run/i)
  assert.ok(sql.includes('driver_tax_secrets'))
  assert.equal(sql.includes('return jsonb_build_object(\n    \'legal_name\', cleaned_name,\n    \'tin_last4\', last4,'), true)
  const hash = createHash('sha256').update(IC_AGREEMENT_HTML, 'utf8').digest('hex')
  assert.equal(hash.length, 64)
  assert.equal(sql.includes(hash), false)
})

test('admin is a profile role or is_admin flag — not an email string', () => {
  assert.equal(isAdminIdentity({ jwtEmail: 'john@gmail.com' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'JOHN@gmail.com' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'johnmatveev@gmail.com' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'JohnMatveyev@gmail.com' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'jmat2019@icloud.com' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', isAdmin: true }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'admin' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'ops' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'driver' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu' }), false)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'support' }), false)
})

const completeApplicant = {
  status: 'pending_review', uploaded: REQUIRED_DOC_IDS,
  backgroundAuthorized: true, workEligibilityAttested: true,
  workEligibilityCategory: 'citizen', taxSaved: true,
  agreementSigned: true, agreementVersion: IC_AGREEMENT_VERSION,
}

test('pending review applicants resume each unfinished electronic step without phantom uploads', () => {
  for (const [patch, step] of [
    [{ uploaded: [] }, 'license'],
    [{ registrationMatch: 'mismatch' }, 'registration'],
    [{ registrationMatch: 'unreadable' }, 'registration'],
    [{ backgroundAuthorized: false }, 'employment'],
    [{ taxSaved: false }, 'w9'],
  ]) {
    const ctx = { ...completeApplicant, ...patch }
    assert.equal(resolveResumeStep({ ...ctx, preferred: 'review' }), step)
    assert.ok(progressSnapshot(ctx).percent < 100)
  }
  assert.deepEqual(submissionBlockers(completeApplicant), [])
  assert.equal(resolveResumeStep(completeApplicant), 'review')
  assert.equal(progressSnapshot(completeApplicant).percent, 100)
  assert.equal(resolveResumeStep({ status: 'pending_info' }), 'account')
})

test('approved drivers skip resume requirements even with no compliance records', () => {
  const ctx = { status: 'approved', uploaded: [], registrationMatch: 'mismatch' }
  assert.equal(resolveResumeStep(ctx), 'review')
  assert.equal(progressSnapshot(ctx).percent, 100)
  assert.equal(canReceiveRides(ctx.status), true)
})
