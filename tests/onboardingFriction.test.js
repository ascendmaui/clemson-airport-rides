import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import {
  approvalBlockers,
  agreementUnsignedNextStepHint,
  blockerLabel,
  firstIncompleteStepId,
  nextStepHint,
  submissionBlockers,
  vehicleYearNextStepHint,
  w9ContinueIssue,
  w9NextStepHint,
  REQUIRED_DOC_IDS,
} from '../shared/driverOnboarding.js'
import { driverQuizError } from '../shared/driverQuiz.js'
import { vehicleAccountErrors, vehicleYearMessage } from '../shared/vehicleYear.js'
import { driverGateView } from '../packages/rides-native/driverGateView.js'

const NOW = new Date('2026-10-05T00:00:00Z')

const web = readFileSync(new URL('../src/screens/DriverOnboarding.jsx', import.meta.url), 'utf8')
const native = readFileSync(new URL('../apps/driver/app/onboarding.tsx', import.meta.url), 'utf8')
const gate = readFileSync(new URL('../packages/rides-native/driverGateView.js', import.meta.url), 'utf8')

/**
 * Messages still shown when a step is incomplete.
 * The three next-step hints below are the replacements for year, W-9, and the unsigned agreement.
 * Document, employment, and skip-ahead copy stays as inventoried here.
 */
const REMAINING_INCOMPLETE_STEPS = [
  { id: 'skip-ahead', where: 'apps/driver/app/onboarding.tsx', text: 'Finish the current step before skipping ahead.' },
  { id: 'photos', where: 'src/screens/DriverOnboarding.jsx', text: 'Add the photos on this step' },
  { id: 'continue-required', where: 'both review screens', text: 'Continue required steps' },
  { id: 'still-needed', where: 'apps/driver/app/onboarding.tsx', text: 'Still needed · ' },
  { id: 'registration-replace', where: 'src/screens/DriverOnboarding.jsx', text: 'Replace the registration with a clear copy matching your vehicle before continuing.' },
  { id: 'eligibility-select', where: 'apps/driver/app/onboarding.tsx', text: 'Select your eligibility to work.' },
  { id: 'eligibility-sign', where: 'apps/driver/app/onboarding.tsx', text: 'Sign and date the authorization and eligibility forms.' },
  { id: 'w9-name-address', where: 'apps/driver/app/onboarding.tsx', text: 'Legal name and address are required.' },
  { id: 'w9-sign', where: 'apps/driver/app/onboarding.tsx', text: 'Sign and date the W-9.' },
  { id: 'agreement-review', where: 'apps/driver/app/onboarding.tsx', text: 'Review the agreement before you sign.' },
  { id: 'agreement-type-name', where: 'apps/driver/app/onboarding.tsx', text: 'Type your legal name and the date to sign.' },
  { id: 'gate-finish-steps', where: 'packages/rides-native/driverGateView.js', text: 'Finish the required steps:' },
  { id: 'gate-missing', where: 'packages/rides-native/driverGateView.js', text: 'Missing:' },
]

const readyDocs = {
  status: 'pending_docs',
  uploaded: REQUIRED_DOC_IDS,
  backgroundAuthorized: true,
  workEligibilityAttested: true,
  workEligibilityCategory: 'citizen',
  taxSaved: true,
  agreementSigned: true,
  agreementVersion: IC_AGREEMENT_VERSION,
  vehicleYear: 2018,
}

test('inventory of remaining incomplete-step messages stays in the screens that show them', () => {
  const sources = { web, native, gate, both: `${web}\n${native}` }
  for (const row of REMAINING_INCOMPLETE_STEPS) {
    const haystack = row.where === 'both review screens'
      ? sources.both
      : row.where.endsWith('DriverOnboarding.jsx')
        ? sources.web
        : row.where.endsWith('onboarding.tsx')
          ? sources.native
          : sources.gate
    assert.ok(haystack.includes(row.text), `${row.id} missing from ${row.where}`)
  }

  assert.equal(blockerLabel('w9_tax_info'), 'W-9 legal name and TIN')
  assert.equal(blockerLabel('ic_agreement'), 'Signed independent contractor agreement')
  assert.equal(blockerLabel('registration_match'), 'Registration that matches the vehicle you entered')
  assert.equal(blockerLabel('background_authorization_attestation'), 'Signed background-check authorization')
  assert.equal(blockerLabel('work_eligibility_attestation'), 'Work-eligibility attestation')
  assert.equal(driverQuizError({ hasCar: false, hasInsurance: true, attestation: true }), 'A car is required to apply as a driver.')
  assert.match(vehicleAccountErrors({ year: '' }, NOW).year, /^Year must be from 1980 to 2027\.$/)
  assert.match(vehicleYearMessage(NOW), /^Vehicle year must be from 1980 to 2027\.$/)
  assert.match(w9ContinueIssue({ legalName: 'A', taxClass: 'individual', tin: '123456789' }), /legal name/i)
  assert.match(web, /item\$\{blockers\.length === 1 \? '' : 's'\} still needed/)

  const lumped = driverGateView('pending_info', { missingItems: ['w9_tax_info', 'ic_agreement'] }).body
  assert.match(lumped, /W-9 legal name and TIN/)
  assert.match(lumped, /Signed independent contractor agreement/)
  assert.equal(lumped.includes(w9NextStepHint()), false)
  assert.equal(lumped.includes(agreementUnsignedNextStepHint()), false)
})

test('next-step hints differ for a missing vehicle year, a pending W-9, and an unsigned agreement', () => {
  const year = nextStepHint({ vehicleYear: '' }, NOW)
  const w9 = nextStepHint({
    vehicleYear: 2018,
    taxSaved: false,
    agreementSigned: true,
    agreementVersion: IC_AGREEMENT_VERSION,
  }, NOW)
  const agreement = nextStepHint({
    vehicleYear: 2018,
    taxSaved: true,
    agreementSigned: false,
  }, NOW)

  assert.equal(year, vehicleYearNextStepHint(NOW))
  assert.equal(w9, w9NextStepHint())
  assert.equal(agreement, agreementUnsignedNextStepHint())
  assert.equal(new Set([year, w9, agreement]).size, 3)

  assert.equal(year, 'Enter the vehicle year (1980 to 2027) on Account, then continue to License.')
  assert.match(year, /vehicle year/i)
  assert.match(year, /Account/)
  assert.match(year, /License/)
  assert.doesNotMatch(year, /W-9|agreement|Submit|unsigned/i)

  assert.equal(w9, 'Finish the W-9 with your legal name and 9-digit TIN, then continue to Agreement.')
  assert.match(w9, /W-9/)
  assert.match(w9, /Agreement/)
  assert.doesNotMatch(w9, /vehicle year|License|unsigned|Submit/i)

  assert.equal(agreement, 'The contractor agreement is unsigned. Continue to Submit. You sign the copy an admin emails you, and approval waits on that signature.')
  assert.match(agreement, /unsigned/)
  assert.match(agreement, /Submit/)
  assert.match(agreement, /approval/i)
  assert.doesNotMatch(agreement, /W-9|vehicle year|License/)

  const generic = [
    'Finish the current step before skipping ahead.',
    'Add the photos on this step',
    'Continue required steps',
    'W-9 legal name and TIN',
    'Signed independent contractor agreement',
    vehicleAccountErrors({ year: '' }, NOW).year,
    vehicleYearMessage(NOW),
    w9ContinueIssue({ legalName: 'A', taxClass: 'individual', tin: '123456789' }),
    w9ContinueIssue({ legalName: 'Ada Lovelace', taxClass: 'nope', tin: '123456789' }),
    w9ContinueIssue({ legalName: 'Ada Lovelace', taxClass: 'individual', tin: '1234' }),
    '1 item still needed: W-9 legal name and TIN.',
    'Still needed · Signed independent contractor agreement',
  ]
  for (const hint of [year, w9, agreement]) {
    assert.equal(generic.includes(hint), false, hint)
  }
})

test('the earliest open gap is the only next-step hint', () => {
  const yearOnly = nextStepHint({ vehicleYear: null }, NOW)
  const allThree = nextStepHint({
    vehicleYear: '',
    taxSaved: false,
    agreementSigned: false,
  }, NOW)
  assert.equal(allThree, yearOnly)

  const w9AndAgreement = nextStepHint({
    vehicleYear: '2018',
    taxSaved: false,
    agreementSigned: false,
  }, NOW)
  assert.equal(w9AndAgreement, w9NextStepHint())

  assert.equal(nextStepHint({
    taxSaved: false,
    agreementSigned: false,
  }, NOW), w9NextStepHint())
  assert.equal(nextStepHint({ agreementSigned: false }, NOW), agreementUnsignedNextStepHint())
})

test('a blank, short, or out-of-range year is the vehicle-year hint and a real year is not', () => {
  for (const vehicleYear of ['', '   ', '19', '1979', '2028', 'abcd', null, undefined, 0]) {
    assert.equal(nextStepHint({ vehicleYear }, NOW), vehicleYearNextStepHint(NOW), String(vehicleYear))
  }
  for (const vehicleYear of [2018, '2018', ' 2027 ']) {
    assert.equal(nextStepHint({ vehicleYear, taxSaved: true, agreementSigned: true, agreementVersion: IC_AGREEMENT_VERSION }, NOW), null)
  }
  assert.equal(nextStepHint({}, NOW), null)
  assert.equal(nextStepHint({ taxSaved: true }, NOW), null)
})

test('year hint still fires after account status moved on, without becoming an approval blocker', () => {
  const ctx = {
    ...readyDocs,
    vehicleYear: null,
  }
  assert.equal(firstIncompleteStepId(ctx), 'review')
  assert.equal(nextStepHint(ctx, NOW), vehicleYearNextStepHint(NOW))
  assert.equal(submissionBlockers(ctx).includes('vehicle_year'), false)
  assert.equal(approvalBlockers(ctx).includes('vehicle_year'), false)
  assert.deepEqual(approvalBlockers(ctx), [])
})

test('pending W-9 points at Agreement and still blocks submit', () => {
  const ctx = { ...readyDocs, taxSaved: false, agreementSigned: false, agreementVersion: null }
  assert.equal(firstIncompleteStepId(ctx), 'w9')
  assert.ok(submissionBlockers(ctx).includes('w9_tax_info'))
  assert.equal(nextStepHint(ctx, NOW), w9NextStepHint())
  assert.doesNotMatch(w9NextStepHint(), /Submit/)
})

test('unsigned agreement points at Submit and blocks approval only', () => {
  const ctx = { ...readyDocs, agreementSigned: false, agreementVersion: null }
  assert.equal(firstIncompleteStepId(ctx), 'review')
  assert.equal(submissionBlockers(ctx).includes('ic_agreement'), false)
  assert.deepEqual(approvalBlockers(ctx), ['ic_agreement'])
  assert.equal(nextStepHint(ctx, NOW), agreementUnsignedNextStepHint())

  const wrongVersion = { ...readyDocs, agreementVersion: 'old-version' }
  assert.equal(nextStepHint(wrongVersion, NOW), agreementUnsignedNextStepHint())
  assert.deepEqual(approvalBlockers(wrongVersion), ['ic_agreement'])

  const hashMismatch = { ...readyDocs, agreementSha256: 'signed', packetHash: 'packet' }
  assert.equal(nextStepHint(hashMismatch, NOW), agreementUnsignedNextStepHint())
  assert.deepEqual(approvalBlockers(hashMismatch), ['ic_agreement'])

  const hashMatch = { ...readyDocs, agreementSha256: 'abc', packetHash: 'abc' }
  assert.equal(nextStepHint(hashMatch, NOW), null)
  assert.deepEqual(approvalBlockers(hashMatch), [])
  assert.deepEqual(submissionBlockers(readyDocs), [])
})
