import test from 'node:test'
import assert from 'node:assert/strict'
import { IC_AGREEMENT_HTML, IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import { DEFAULT_APPLICANT_FROM, resolveApplicantFrom, sendApplicantNotice } from './applicantMail.js'
import {
  accountSavedNotice,
  applicationInfoLines,
  decisionNotice,
  signedAgreementNotice,
  stageNotice,
  stageReady,
  submittedNotice,
} from './driverApplicantMail.js'

test('applicant mail uses applications@clemsonrides.com unless RESEND_FROM is set', () => {
  assert.equal(resolveApplicantFrom({}), DEFAULT_APPLICANT_FROM)
  assert.match(DEFAULT_APPLICANT_FROM, /applications@clemsonrides\.com/)
  assert.equal(resolveApplicantFrom({ RESEND_FROM: '  Desk <desk@clemsonrides.com>  ' }), 'Desk <desk@clemsonrides.com>')
})

test('sendApplicantNotice does not call Resend without an API key', async () => {
  let called = false
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    called = true
    throw new Error('live send')
  }
  try {
    const notice = await sendApplicantNotice({
      to: 'ada@clemson.edu',
      subject: 'Hello',
      text: 'Body',
    }, { RESEND_API_KEY: '', RESEND_FROM: '' })
    assert.equal(notice.emailed, false)
    assert.equal(notice.from, DEFAULT_APPLICANT_FROM)
    assert.match(notice.todo, /applications@clemsonrides\.com/)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = original
  }
})

test('sendApplicantNotice posts to Resend with the default from-address when a key is set', async () => {
  const original = globalThis.fetch
  let payload = null
  globalThis.fetch = async (url, init) => {
    payload = { url, body: JSON.parse(init.body) }
    return { ok: true, json: async () => ({ id: 'email_123' }) }
  }
  try {
    const notice = await sendApplicantNotice({
      to: 'ada@clemson.edu',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
    }, { RESEND_API_KEY: 're_test_key', RESEND_FROM: '' })
    assert.equal(notice.emailed, true)
    assert.equal(notice.id, 'email_123')
    assert.equal(payload.url, 'https://api.resend.com/emails')
    assert.equal(payload.body.from, DEFAULT_APPLICANT_FROM)
    assert.deepEqual(payload.body.to, ['ada@clemson.edu'])
    assert.equal(payload.body.html, '<p>Body</p>')
  } finally {
    globalThis.fetch = original
  }
})

test('stage mail is a confirmation plus a reminder of what is still open', () => {
  assert.equal(stageReady('license', { uploaded: ['license_front'] }), false)
  assert.equal(stageReady('license', { uploaded: ['license_front', 'license_back'] }), true)
  assert.equal(stageReady('w9', { taxSaved: false }), false)
  assert.equal(stageReady('payroll', {}), false)

  const account = accountSavedNotice({ name: 'Ada', ctx: { agreementSigned: false } })
  assert.match(account.subject, /account saved/)
  assert.match(account.text, /independent contractor agreement/)
  assert.match(account.text, /Ada/)

  const license = stageNotice({
    stage: 'license',
    name: 'Ada',
    ctx: { uploaded: ['license_front', 'license_back'], agreementSigned: false },
  })
  assert.match(license.subject, /Driver license saved/)
  assert.match(license.text, /Still to finish/)

  const submitted = submittedNotice({ name: 'Ada' })
  assert.match(submitted.text, /waiting for admin review/)
  assert.match(submitted.text, /signed independent contractor agreement/)

  const approved = decisionNotice({ name: 'Ada', decision: 'approve' })
  assert.match(approved.text, /approved/)
  const rejected = decisionNotice({ name: 'Ada', decision: 'reject', reason: 'Plate is unreadable' })
  assert.match(rejected.text, /Plate is unreadable/)
})

test('the signed-agreement email includes the document and application info, not a full TIN', () => {
  const notice = signedAgreementNotice({
    name: 'Ada Lovelace',
    profile: { full_name: 'Ada Lovelace', email: 'ada@clemson.edu', phone: '8645550100' },
    vehicle: { color: 'Orange', make: 'Honda', model: 'Civic', plate: 'CLEM1' },
    tax: { legal_name: 'Ada Lovelace', tin_last4: '6789' },
    documents: ['license_front'],
    employment: { work_eligibility_category: 'citizen' },
    agreement: {
      signature_name: 'Ada Lovelace',
      signed_at: '2026-09-24T15:00:00.000Z',
      agreement_version: IC_AGREEMENT_VERSION,
      agreement_sha256: 'abc123',
      html_snapshot: IC_AGREEMENT_HTML,
    },
  })
  assert.match(notice.subject, /independent contractor agreement/)
  assert.match(notice.text, /Ada Lovelace/)
  assert.match(notice.text, /ada@clemson\.edu/)
  assert.match(notice.text, /CLEM1/)
  assert.match(notice.text, /••••6789/)
  assert.match(notice.text, /abc123/)
  assert.match(notice.text, /Independent Contractor Agreement/)
  assert.equal(notice.text.includes('123456789'), false)
  assert.match(notice.html, /<h1>Clemson RIDES Independent Contractor Agreement<\/h1>/)
  assert.match(applicationInfoLines({
    profile: { full_name: 'Ada' },
    tax: { tin_last4: '6789' },
  }).join('\n'), /••••6789/)
})
