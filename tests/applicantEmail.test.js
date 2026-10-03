import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  APPLICANT_FROM_ADDRESS,
  missingApplicantEmailColumn,
  normalizeApplicantEmail,
  submittedApplicantEmail,
  withApplicantEmail,
  withSubmittedApplicantEmail,
} from '../shared/applicantEmail.js'
import { EMAIL_TODO } from '../shared/driverOnboarding.js'
import { resolveApplicantFromAddress } from '../server/resendFrom.js'
import { sendApplicantNotice } from '../server/applicantMail.js'

test('submitted applicant email prefers the address stored on the application', () => {
  assert.equal(normalizeApplicantEmail('  Ada@Clemson.edu '), 'ada@clemson.edu')
  assert.equal(normalizeApplicantEmail('not-an-email'), '')
  assert.equal(
    submittedApplicantEmail(
      { applicant_email: 'submitted@clemson.edu' },
      { email: 'profile@gmail.com' },
    ),
    'submitted@clemson.edu',
  )
  assert.equal(
    submittedApplicantEmail({ applicant_email: '' }, { email: 'Profile@gmail.com' }),
    'profile@gmail.com',
  )
  assert.equal(submittedApplicantEmail({}, {}), '')
})

test('admin queue row exposes the submitted email even when the profile email differs', () => {
  const row = withSubmittedApplicantEmail(
    { id: 'app-1', profile_id: 'user-1', applicant_email: 'submitted@clemson.edu' },
    { id: 'user-1', full_name: 'Ada', email: 'other@gmail.com' },
  )
  assert.equal(row.applicant_email, 'submitted@clemson.edu')
  assert.equal(row.profile.email, 'submitted@clemson.edu')
  assert.equal(row.profile.full_name, 'Ada')

  const fromProfile = withSubmittedApplicantEmail(
    { id: 'app-2', profile_id: 'user-2' },
    { id: 'user-2', full_name: 'Bea', email: 'bea@clemson.edu' },
  )
  assert.equal(fromProfile.applicant_email, 'bea@clemson.edu')
  assert.equal(fromProfile.profile.email, 'bea@clemson.edu')
})

test('application writes include a normalized applicant email', () => {
  assert.deepEqual(
    withApplicantEmail({ profile_id: 'user-1' }, 'Tiger@Clemson.edu'),
    { profile_id: 'user-1', applicant_email: 'tiger@clemson.edu' },
  )
  assert.deepEqual(withApplicantEmail({ profile_id: 'user-1' }, ''), { profile_id: 'user-1' })
  assert.equal(
    missingApplicantEmailColumn({ message: "Could not find the 'applicant_email' column of 'driver_applications' in the schema cache" }),
    true,
  )
  assert.equal(missingApplicantEmailColumn({ message: 'permission denied' }), false)
})

test('review list copy shows the email and no longer says the list omits it', () => {
  const screen = readFileSync(new URL('../src/screens/AdminDrivers.jsx', import.meta.url), 'utf8')
  assert.match(screen, /submittedApplicantEmail/)
  assert.match(screen, /data-applicant-email/)
  assert.match(screen, />Email</)
  assert.match(screen, /applications@clemsonrides\.com|APPLICANT_FROM_ADDRESS/)
  assert.equal(EMAIL_TODO.includes('without email'), false)
  assert.match(EMAIL_TODO, /applications@clemsonrides\.com/)
  assert.match(EMAIL_TODO, /shown in this review list/)
})

test('Resend from address stays on clemsonrides.com', () => {
  const previousFrom = process.env.RESEND_FROM
  delete process.env.RESEND_FROM
  try {
    assert.equal(APPLICANT_FROM_ADDRESS, 'applications@clemsonrides.com')
    assert.equal(resolveApplicantFromAddress(), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress(''), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress('notify@my-preview.vercel.app'), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress('Clemson <onboarding@something.vercel.app>'), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress('placeholder@clemsonrides.com'), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress('onboarding@resend.dev'), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress('person@gmail.com'), APPLICANT_FROM_ADDRESS)
    assert.equal(resolveApplicantFromAddress('ops@clemsonrides.com'), 'ops@clemsonrides.com')
    assert.equal(
      resolveApplicantFromAddress('Clemson RIDES <applications@clemsonrides.com>'),
      'Clemson RIDES <applications@clemsonrides.com>',
    )
  } finally {
    if (previousFrom == null) delete process.env.RESEND_FROM
    else process.env.RESEND_FROM = previousFrom
  }
})

test('applicant notice does not call Resend without a key and posts the clemsonrides.com from address when configured', async () => {
  const previousKey = process.env.RESEND_API_KEY
  const previousFrom = process.env.RESEND_FROM
  const originalFetch = globalThis.fetch
  try {
    delete process.env.RESEND_API_KEY
    process.env.RESEND_FROM = 'notify@preview.vercel.app'
    let called = false
    globalThis.fetch = async () => {
      called = true
      return { ok: true, json: async () => ({}) }
    }
    const skipped = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Hi', text: 'Hello' })
    assert.equal(skipped.emailed, false)
    assert.equal(called, false)
    assert.match(skipped.todo, /applications@clemsonrides\.com/)

    process.env.RESEND_API_KEY = 'test-resend-key'
    let posted = null
    globalThis.fetch = async (url, init) => {
      posted = { url, body: JSON.parse(init.body) }
      return { ok: true, json: async () => ({ id: 'email_test' }) }
    }
    const sent = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Hi', text: 'Hello' })
    assert.equal(sent.emailed, true)
    assert.equal(posted.url, 'https://api.resend.com/emails')
    assert.equal(posted.body.from, 'applications@clemsonrides.com')
    assert.deepEqual(posted.body.to, ['ada@clemson.edu'])
    assert.equal(posted.body.subject, 'Hi')
    assert.equal(posted.body.text, 'Hello')
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey == null) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousKey
    if (previousFrom == null) delete process.env.RESEND_FROM
    else process.env.RESEND_FROM = previousFrom
  }
})
