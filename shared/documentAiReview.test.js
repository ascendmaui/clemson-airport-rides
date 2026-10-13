import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ATTENTION_COPY } from '../packages/rides-native/documentCategories.js'
import {
  AUTO_APPROVE_CONFIDENCE,
  SCORE_WEIGHTS,
  decideDocumentReview,
  documentAttentionItems,
  nameSimilarity,
  plateFormatOk,
  vinCheckDigit,
} from './documentAiReview.js'

const VALID_VIN = '1HGCM82633A004352'
const NOW = new Date('2026-10-13T12:00:00.000Z')

const REGISTRATION = {
  name: 'Ada Driver',
  expiryDate: '2030-06-01',
  plate: 'ABC123',
  vin: VALID_VIN,
  state: 'SC',
  documentType: 'registration',
  legible: 'yes',
}

function registrationInput(overrides = {}) {
  const pass = { ...REGISTRATION, ...(overrides.pass || {}) }
  return {
    docType: 'registration',
    passA: pass,
    passB: { ...pass, ...(overrides.passB || {}) },
    profileName: overrides.profileName ?? 'Ada Driver',
    vehicle: overrides.vehicle ?? { plate: 'ABC123', vin: VALID_VIN },
    sibling: overrides.sibling || {},
    byteLength: overrides.byteLength ?? 80_000,
    width: overrides.width ?? 1200,
    height: overrides.height ?? 800,
    now: NOW,
  }
}

test('VIN check digit accepts a valid VIN and rejects length, I/O/Q, and a bad check digit', () => {
  const valid = vinCheckDigit(VALID_VIN)
  assert.equal(valid.ok, true)
  assert.equal(valid.expected, '3')
  assert.equal(vinCheckDigit('1hgcm82633a004352').ok, true)
  assert.equal(vinCheckDigit('1HGCM82643A004352').ok, false)
  assert.equal(vinCheckDigit('1HGCM82643A004352').reason, 'check-digit')
  assert.equal(vinCheckDigit('1HGCM82633A00435I').ok, false)
  assert.equal(vinCheckDigit('1HGCM82633A00435I').reason, 'forbidden-letter')
  assert.equal(vinCheckDigit('1HGCM82633A00435O').reason, 'forbidden-letter')
  assert.equal(vinCheckDigit('1HGCM82633A00435Q').reason, 'forbidden-letter')
  assert.equal(vinCheckDigit('1HGCM82633A00435').ok, false)
  assert.equal(vinCheckDigit('1HGCM82633A00435').reason, 'length')
  assert.equal(vinCheckDigit('').ok, false)
})

test('scoring weights sum to 1 and a clean registration auto-approves', () => {
  const total = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
  assert.equal(Math.round(total * 1000) / 1000, 1)
  assert.equal(AUTO_APPROVE_CONFIDENCE, 0.85)
  const decision = decideDocumentReview(registrationInput())
  assert.equal(decision.reviewStatus, 'approved')
  assert.equal(decision.aiVerdict, 'approved')
  assert.ok(decision.aiConfidence >= 0.85)
  assert.deepEqual(decision.hardRules, [])
  assert.equal(decision.driverMessage, 'Approved')
  assert.notEqual(decision.reviewStatus, 'rejected')
})

test('hard rules block approval and the model never rejects', () => {
  const expired = decideDocumentReview(registrationInput({ pass: { expiryDate: '2020-01-01' } }))
  assert.equal(expired.reviewStatus, 'pending_manual_review')
  assert.ok(expired.hardRules.includes('expired'))
  assert.match(expired.aiReason, /expired/i)
  assert.notEqual(expired.reviewStatus, 'rejected')

  const mismatch = decideDocumentReview(registrationInput({ pass: { name: 'Jane Other' } }))
  assert.ok(mismatch.hardRules.includes('name_mismatch'))
  assert.notEqual(mismatch.reviewStatus, 'approved')
  assert.match(mismatch.aiReason, /does not match the name on your profile/i)
  assert.ok(nameSimilarity('Ada Q Driver', 'Ada Driver') >= 0.85)
  assert.ok(nameSimilarity('Jane Other', 'Ada Driver') < 0.85)

  const badVin = decideDocumentReview(registrationInput({
    pass: { vin: '1HGCM82643A004352' },
    vehicle: { plate: 'ABC123', vin: '' },
  }))
  assert.ok(badVin.hardRules.includes('vin_check_digit'))
  assert.notEqual(badVin.reviewStatus, 'approved')
  assert.match(badVin.aiReason, /not valid/i)

  const badPlate = decideDocumentReview(registrationInput({ pass: { plate: 'ZZZ999' } }))
  assert.ok(badPlate.hardRules.includes('plate_mismatch'))
  assert.notEqual(badPlate.reviewStatus, 'approved')
  assert.match(badPlate.aiReason, /does not match the plate/i)
  assert.equal(plateFormatOk('ABC123'), true)
  assert.equal(plateFormatOk('A'), false)
})

test('confidence under 0.85 stays in manual review even without a hard rule', () => {
  const blurry = decideDocumentReview(registrationInput({ byteLength: 4000, width: 200, height: 100 }))
  assert.ok(blurry.aiConfidence < AUTO_APPROVE_CONFIDENCE)
  assert.equal(blurry.reviewStatus, 'pending_manual_review')
  assert.equal(blurry.aiVerdict, 'needs_admin')
  assert.match(blurry.aiReason, /hard to read/i)
  assert.notEqual(blurry.reviewStatus, 'rejected')
})

test('the driver home lists pending, manual, and re-upload documents with their reasons', () => {
  const items = documentAttentionItems([
    { doc_type: 'license_front', storage_path: 'd/license_front/a.jpg', review_status: 'approved' },
    {
      doc_type: 'license_back',
      storage_path: 'd/license_back/a.jpg',
      review_status: 'pending_manual_review',
      ai_reason: 'This document is waiting for manual review.',
    },
    {
      doc_type: 'insurance_front',
      storage_path: 'd/insurance_front/a.jpg',
      review_status: 'pending_admin_review',
      ai_reason: 'The expiration date could not be read.',
    },
    { doc_type: 'registration', storage_path: 'd/registration/a.jpg', review_status: 'rejected', review_note: 'Upload this again so we can review a clearer copy.' },
    { doc_type: 'inspection_form', storage_path: 'd/inspection_form/a.pdf', review_status: 'pending', ai_reason: 'Waiting on the plate.' },
  ])
  assert.equal(items.some((item) => item.id === 'license_front'), false)
  const back = items.find((item) => item.id === 'license_back')
  assert.equal(back.kind, 'manual')
  assert.match(back.reason, /manual review/i)
  const insurance = items.find((item) => item.id === 'insurance_front')
  assert.equal(insurance.kind, 'pending')
  assert.match(insurance.reason, /expiration date/i)
  const registration = items.find((item) => item.id === 'registration')
  assert.equal(registration.kind, 'reupload')
  assert.match(registration.reason, /clearer copy/i)
  const form = items.find((item) => item.id === 'inspection_form')
  assert.match(form.reason, /plate/i)
  assert.equal(items.find((item) => item.id === 'insurance_back').kind, 'reupload')

  const home = readFileSync(new URL('../apps/driver/app/(tabs)/index.tsx', import.meta.url), 'utf8')
  assert.equal(ATTENTION_COPY, 'Needs your attention')
  assert.match(home, /documentAttentionItems/)
  assert.match(home, /\{ATTENTION_COPY\}/)
  assert.match(home, /borderColor: colors\.orange/)
  assert.match(home, /item\.reason/)
  assert.match(home, /documentGate\.sections\.map\(\(section\) => section\.label\)/)
})
