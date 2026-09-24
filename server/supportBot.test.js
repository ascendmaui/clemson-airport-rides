import assert from 'node:assert/strict'
import test from 'node:test'
import { isAdminIdentity, SEEDED_ADMIN_EMAILS } from '../shared/adminAccess.js'
import { BOT_CONFIDENCE_FLOOR, botShouldEscalate, decideSupportBot } from './supportBot.js'

const rider = {
  role: 'rider',
  student: { verified: true },
  billing: { hasCard: true, brand: 'visa', last4: '4242' },
  recentTrips: [{ status: 'completed', pickup: 'Memorial Stadium', dropoff: 'GSP', fareUsd: 40, peerFirstName: 'Bo' }],
  driverApplication: null,
  vehicle: null,
}

test('seeded admin emails include both spellings and the iCloud account', () => {
  assert.equal(SEEDED_ADMIN_EMAILS.includes('johnmatveev@gmail.com'), true)
  assert.equal(SEEDED_ADMIN_EMAILS.includes('johnmatveyev@gmail.com'), true)
  assert.equal(SEEDED_ADMIN_EMAILS.includes('jmat2019@icloud.com'), true)
  assert.equal(SEEDED_ADMIN_EMAILS.includes('john@gmail.com'), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'jmat2019@icloud.com' }), true)
  assert.equal(isAdminIdentity({ jwtEmail: 'student@clemson.edu', role: 'support' }), false)
})

test('account and payment how-tos resolve without an admin', () => {
  const account = decideSupportBot({ text: 'I forgot my password and cannot sign in', context: rider })
  assert.equal(account.escalate, false)
  assert.equal(account.status, 'resolved')
  assert.match(account.reply, /Forgot password/)
  assert.ok(account.confidence >= BOT_CONFIDENCE_FLOOR)

  const pay = decideSupportBot({ text: 'Where does the airport deposit charge come from?', context: rider, category: 'billing' })
  assert.equal(pay.escalate, false)
  assert.equal(pay.status, 'resolved')
  assert.match(pay.reply, /4242/)
  assert.equal(botShouldEscalate(pay), false)
})

test('refunds, safety, human requests, and unknown intent escalate', () => {
  const refund = decideSupportBot({ text: 'I was charged twice for the GSP deposit yesterday.', context: rider })
  assert.equal(refund.status, 'escalated')
  assert.equal(refund.reason, 'refund_needs_admin')

  const human = decideSupportBot({ text: 'I want to talk to a real person about this.', context: rider })
  assert.equal(human.reason, 'human_requested')
  assert.equal(human.status, 'escalated')

  const safety = decideSupportBot({ text: 'I felt unsafe after the ride and want this reviewed.', context: rider })
  assert.equal(safety.reason, 'safety')
  assert.equal(safety.status, 'escalated')

  const unknown = decideSupportBot({ text: 'Please look at the purple widget on the third moon.', context: rider })
  assert.equal(unknown.intent, 'unknown')
  assert.equal(unknown.status, 'escalated')
  assert.equal(unknown.reason, 'unknown_intent')
  assert.equal(botShouldEscalate(unknown), true)
})

test('driver application status is answered from context', () => {
  const pending = decideSupportBot({
    text: 'What is my driver application status? Can I accept rides?',
    context: { ...rider, role: 'driver', driverApplication: { status: 'pending' } },
    roleVariant: 'driver',
  })
  assert.equal(pending.escalate, false)
  assert.equal(pending.status, 'resolved')
  assert.match(pending.reply, /cannot accept rides/i)

  const approved = decideSupportBot({
    text: 'Is my driver application approved yet?',
    context: { ...rider, driverApplication: { status: 'approved' } },
    roleVariant: 'driver',
  })
  assert.match(approved.reply, /go online/i)
  assert.equal(approved.status, 'resolved')
})

test('a short message asks for a topic instead of paging an admin', () => {
  const short = decideSupportBot({ text: 'Help me', context: rider })
  assert.equal(short.status, 'waiting_user')
  assert.equal(short.escalate, false)
  assert.equal(botShouldEscalate(short), false)
})

test('an unexplained bug escalates on low confidence', () => {
  const bug = decideSupportBot({ text: 'The schedule screen crashed when I picked CLT.', context: rider, category: 'bug' })
  assert.equal(bug.status, 'escalated')
  assert.ok(bug.confidence < BOT_CONFIDENCE_FLOOR)
  assert.equal(bug.reason, 'low_confidence')
})
