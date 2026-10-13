import test from 'node:test'
import assert from 'node:assert/strict'
import { IC_AGREEMENT_VERSION, REQUIRED_DOC_IDS, approvalBlockers } from '../shared/driverOnboarding.js'
import {
  assessContractIdentity,
  blockersIgnoringContractIdentity,
  contractApprovalDenial,
  contractMismatchCopy,
  personNamesMatch,
  pickAgreementRow,
} from '../shared/contractIdentity.js'

const ready = {
  uploaded: REQUIRED_DOC_IDS,
  backgroundAuthorized: true,
  workEligibilityAttested: true,
  workEligibilityCategory: 'citizen',
  taxSaved: true,
  agreementSigned: true,
  agreementVersion: IC_AGREEMENT_VERSION,
}

test('person names match after case, spacing, unicode, and middle-name differences', () => {
  assert.equal(personNamesMatch('John Matveyev', 'john matveyev'), true)
  assert.equal(personNamesMatch('John  Matveyev', 'John Matveyev'), true)
  assert.equal(personNamesMatch('John\u00A0Matveyev', 'John Matveyev'), true)
  assert.equal(personNamesMatch('John\u200B Matveyev', 'John Matveyev'), true)
  assert.equal(personNamesMatch('Jöhn Matveyev', 'John Matveyev'), true)
  assert.equal(personNamesMatch('John M\u0430tveyev', 'John Matveyev'), true)
  assert.equal(personNamesMatch('John A. Matveyev', 'John Matveyev'), true)
  assert.equal(personNamesMatch('Matveyev, John', 'John Matveyev'), true)
  assert.equal(personNamesMatch('John', 'John Matveyev'), true)
  assert.equal(personNamesMatch('Jane Doe', 'John Matveyev'), false)
  assert.equal(personNamesMatch('John Smith', 'John Matveyev'), false)
  assert.equal(personNamesMatch('', 'John Matveyev'), false)
})

test('identical displayed names are a match, including a short signature on the same legal name', () => {
  const same = assessContractIdentity({
    signatureName: 'John',
    contractLegalName: 'John Matveyev',
    applicantName: 'John\u00A0Matveyev',
    applicantLegalName: 'John Matveyev',
  })
  assert.equal(same.status, 'match')

  const spaced = assessContractIdentity({
    signatureName: 'John  Matveyev',
    applicantName: 'John Matveyev',
  })
  assert.equal(spaced.status, 'match')
  assert.equal(approvalBlockers({
    ...ready,
    agreementVersion: 'ic-agreement-2026-09-23',
    agreementSha256: 'signed-old',
    packetHash: 'packet-new',
    ...same,
    signatureName: 'John',
    contractLegalName: 'John Matveyev',
    applicantName: 'John Matveyev',
    applicantLegalName: 'John Matveyev',
  }).includes('ic_agreement'), false)
})

test('a different contract name warns and still leaves approval available after confirm', () => {
  const identity = assessContractIdentity({
    signatureName: 'Ada Lovelace',
    contractLegalName: 'Ada Lovelace',
    applicantName: 'John Matveyev',
    applicantLegalName: 'John Matveyev',
  })
  assert.equal(identity.status, 'mismatch')
  assert.equal(
    contractMismatchCopy(identity.contractName, identity.applicantName),
    "Signed contract is for driver 'Ada Lovelace' but you are viewing applicant 'John Matveyev'. Please check the contract again.",
  )
  assert.equal(approvalBlockers({
    ...ready,
    agreementVersion: 'ic-agreement-2026-09-23',
    signatureName: 'Ada Lovelace',
    applicantName: 'John Matveyev',
  }).includes('ic_agreement'), false)
  const denied = contractApprovalDenial({ agreementSigned: true, identity, acknowledged: false })
  assert.equal(denied.status, 400)
  assert.match(denied.body.error, /Ada Lovelace/)
  assert.equal(contractApprovalDenial({ agreementSigned: true, identity, acknowledged: true }), null)
  assert.deepEqual(
    blockersIgnoringContractIdentity(['ic_agreement', 'w9_tax_info'], identity, true),
    ['w9_tax_info'],
  )
})

test('an unsigned application stays blocked even when the legal names match', () => {
  assert.deepEqual(approvalBlockers({
    ...ready,
    agreementSigned: false,
    agreementVersion: null,
    signatureName: null,
    contractLegalName: 'John Matveyev',
    applicantName: 'John Matveyev',
  }), ['ic_agreement'])
  assert.deepEqual(approvalBlockers({
    ...ready,
    agreementVersion: 'old-version',
    agreementSha256: 'signed',
    packetHash: 'packet',
  }), ['ic_agreement'])
})

test('pickAgreementRow keeps an older signed copy when the current version is unsigned', () => {
  const picked = pickAgreementRow([
    { agreement_version: 'ic-agreement-2026-09-23', signature_name: 'John', signed_at: '2026-10-01T00:00:00Z' },
    { agreement_version: IC_AGREEMENT_VERSION, signature_name: null, signed_at: null },
  ], IC_AGREEMENT_VERSION)
  assert.equal(picked.signature_name, 'John')
  const current = pickAgreementRow([
    { agreement_version: 'ic-agreement-2026-09-23', signature_name: 'John', signed_at: '2026-10-01T00:00:00Z' },
    { agreement_version: IC_AGREEMENT_VERSION, signature_name: 'John Matveyev', signed_at: '2026-10-02T00:00:00Z' },
  ], IC_AGREEMENT_VERSION)
  assert.equal(current.agreement_version, IC_AGREEMENT_VERSION)
})
