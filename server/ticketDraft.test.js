import assert from 'node:assert/strict'
import test from 'node:test'
import { TICKET_CATEGORIES, extractTicketDraft } from './ticketDraft.js'

test('TICKET_CATEGORIES defines supported support categories', () => {
  assert.deepEqual(TICKET_CATEGORIES, [
    'bug',
    'billing',
    'ride_dispute',
    'account',
    'safety',
    'other',
  ])
})

test('extractTicketDraft handles plain text without ticket block', () => {
  const plain = 'Hello, how can I assist you with Clemson rides today?'
  const result = extractTicketDraft(plain)
  assert.equal(result.visible, plain)
  assert.equal(result.draft, null)

  assert.equal(extractTicketDraft('').visible, '')
  assert.equal(extractTicketDraft(null).visible, '')
  assert.equal(extractTicketDraft(undefined).draft, null)
})

test('extractTicketDraft parses valid ticket draft and separates visible message', () => {
  const response = `I understand your concern about the charged wait fee. I have prepared a support ticket for our operations team to review.

TICKET_DRAFT: {
  "category": "billing",
  "ready": true,
  "subject": "Wait fee dispute for trip #450",
  "body": "Rider arrived at pickup before the 5-minute threshold but was charged $2.00 wait fee."
}`

  const { visible, draft } = extractTicketDraft(response)
  assert.equal(
    visible,
    'I understand your concern about the charged wait fee. I have prepared a support ticket for our operations team to review.',
  )
  assert.ok(draft)
  assert.equal(draft.category, 'billing')
  assert.equal(draft.ready, true)
  assert.equal(draft.subject, 'Wait fee dispute for trip #450')
  assert.equal(
    draft.body,
    'Rider arrived at pickup before the 5-minute threshold but was charged $2.00 wait fee.',
  )
})

test('extractTicketDraft enforces category restrictions and ready flag', () => {
  // Invalid category
  const badCategory = `I will open a ticket.
TICKET_DRAFT: {
  "category": "advertising",
  "ready": true,
  "subject": "Ad promo question",
  "body": "Rider asking about promotional billboards."
}`
  assert.equal(extractTicketDraft(badCategory).draft, null)

  // ready flag is false
  const notReady = `Drafting ticket...
TICKET_DRAFT: {
  "category": "safety",
  "ready": false,
  "subject": "Driver speeding report",
  "body": "Driver exceeded speed limit on Highway 123."
}`
  assert.equal(extractTicketDraft(notReady).draft, null)
})

test('extractTicketDraft enforces minimum subject and body length thresholds', () => {
  // Short subject (< 4 chars)
  const shortSubject = `Support ticket:
TICKET_DRAFT: {
  "category": "bug",
  "ready": true,
  "subject": "App",
  "body": "App crashed when clicking the carpool button on schedule screen."
}`
  assert.equal(extractTicketDraft(shortSubject).draft, null)

  // Short body (< 8 chars)
  const shortBody = `Support ticket:
TICKET_DRAFT: {
  "category": "bug",
  "ready": true,
  "subject": "Crash on open",
  "body": "Broken!"
}`
  assert.equal(extractTicketDraft(shortBody).draft, null)
})

test('extractTicketDraft handles malformed JSON gracefully', () => {
  const malformed = `Here is your draft:
TICKET_DRAFT: {
  category: billing,
  ready: true,
  subject: missing quotes,
}`
  const result = extractTicketDraft(malformed)
  assert.equal(result.visible, 'Here is your draft:')
  assert.equal(result.draft, null)
})
