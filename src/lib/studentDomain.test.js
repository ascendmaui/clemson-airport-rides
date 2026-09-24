import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STUDENT_CONFIRM_EMAIL_COPY,
  STUDENT_EMAIL_REQUIRED_COPY,
  emailConfirmationState,
  isClemsonEmail,
  studentDiscountGranted,
} from './studentDomain.js'

test('clemson student domains are exact and case-insensitive', () => {
  assert.equal(isClemsonEmail(' Tiger@Clemson.edu '), true)
  assert.equal(isClemsonEmail('tiger@g.clemson.edu'), true)
  assert.equal(isClemsonEmail('tiger@G.CLEMSON.EDU'), true)
  assert.equal(isClemsonEmail('tiger@gmail.com'), false)
  assert.equal(isClemsonEmail('tiger@notclemson.edu'), false)
  assert.equal(isClemsonEmail('tiger@clemson.edu.evil.com'), false)
  assert.equal(isClemsonEmail('tiger@mail.clemson.edu'), false)
  assert.equal(isClemsonEmail('tiger@gclemson.edu'), false)
  assert.equal(isClemsonEmail('@clemson.edu'), false)
  assert.equal(isClemsonEmail(''), false)
  assert.equal(isClemsonEmail(null), false)
})

test('student discount follows a confirmed auth email and ignores profile flags', () => {
  const confirmed = { email: 'ada@g.clemson.edu', email_confirmed_at: '2026-09-01T00:00:00Z' }
  assert.equal(studentDiscountGranted(confirmed), true)
  assert.equal(studentDiscountGranted({
    email: 'ada@gmail.com',
    email_confirmed_at: '2026-09-01T00:00:00Z',
    student_verified_at: '2026-09-01T00:00:00Z',
  }), false)
  assert.equal(studentDiscountGranted({
    email: 'ada@clemson.edu',
    email_confirmed_at: null,
    student_verified_at: '2026-09-01T00:00:00Z',
  }), false)
  assert.equal(studentDiscountGranted({
    email: 'ada@clemson.edu',
    identities: [{ identity_data: { email_verified: true } }],
  }), true)
  assert.equal(studentDiscountGranted(null), false)
  assert.equal(emailConfirmationState({ email_confirmed_at: null }), 'unconfirmed')
  assert.match(STUDENT_EMAIL_REQUIRED_COPY, /@clemson\.edu/)
  assert.match(STUDENT_EMAIL_REQUIRED_COPY, /@g\.clemson\.edu/)
  assert.match(STUDENT_CONFIRM_EMAIL_COPY, /Confirm the Clemson email/)
})
