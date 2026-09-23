import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHelpTurn, helpSystemPrompt } from './helpAgent.js'
import { buildSupportTurn, extractTicketDraft, supportSystemPrompt, validateTicket } from './supportAgent.js'
import { sanitizeActions } from './productKnowledge.js'
import { contextSummary, resolveRoleVariant } from './userContext.js'
import { resetRateLimits } from './agentHttp.js'
import helpHandler from '../api/help-chat.js'
import supportHandler from '../api/support-chat.js'

const rider = {
  signedIn: true,
  name: 'Ada',
  email: 'ada@clemson.edu',
  role: 'rider',
  student: { verified: true, verifiedAt: '2026-09-01', emailEligible: true },
  ratings: { avg: 5, count: 1 },
  billing: { hasCard: false, brand: null, last4: null, activated: false },
  vehicle: null,
  driverApplication: null,
  driverOnline: null,
  pendingRating: { tripId: 'trip-1', pickup: 'Memorial Stadium', dropoff: 'GSP' },
  recentTrips: [{ id: 'trip-1', status: 'completed', as: 'rider', pickup: 'Memorial Stadium', dropoff: 'GSP', fareUsd: 67.5 }],
}

const driver = {
  signedIn: true,
  name: 'Bo',
  email: 'bo@clemson.edu',
  role: 'driver',
  student: { verified: true, verifiedAt: null, emailEligible: true },
  ratings: { avg: null, count: 0 },
  billing: { hasCard: true, brand: 'visa', last4: '4242', activated: true },
  vehicle: null,
  driverApplication: { status: 'pending', reviewedAt: null },
  driverOnline: false,
  pendingRating: null,
  recentTrips: [],
}

function mockRes() {
  let body = ''
  return {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    end(payload) {
      this.headersSent = true
      this.writableEnded = true
      if (payload) body += payload
      this.body = body
    },
  }
}

test('rider help diagnoses a missing card and does not file a ticket', () => {
  const turn = buildHelpTurn({
    messages: [{ role: 'user', content: 'Where do I add a card for rides?' }],
    context: rider,
    roleVariant: 'rider',
  })
  assert.match(turn.reply, /Ada/)
  assert.match(turn.reply, /Account → Billing → Add a card/)
  assert.match(turn.reply, /Memorial Stadium/)
  assert.equal(turn.actions.some((item) => item.route === 'account' && item.params.tab === 'billing'), true)
  assert.equal(JSON.stringify(turn).includes('ticket was'), false)
  assert.match(turn.system, /do not output TICKET_DRAFT/i)
  assert.match(helpSystemPrompt('rider', rider), /do not create support tickets/i)
})

test('help sends charge disputes to Support without creating a ticket', () => {
  const turn = buildHelpTurn({
    messages: [{ role: 'user', content: 'I was charged twice for my deposit' }],
    context: rider,
    roleVariant: 'rider',
  })
  assert.match(turn.reply, /Account → Support/)
  assert.equal(turn.actions.some((item) => item.params.tab === 'support'), true)
  assert.doesNotMatch(turn.reply, /filed ticket|ticket id/i)
})

test('driver help explains signup when the application is not approved', () => {
  const turn = buildHelpTurn({
    messages: [{ role: 'user', content: 'How do I finish driver signup and get approved?' }],
    context: driver,
    roleVariant: 'driver',
  })
  assert.match(turn.reply, /pending/)
  assert.match(turn.reply, /Driver signup/)
  assert.equal(turn.actions.some((item) => item.route === 'driver-signup'), true)
  assert.match(turn.reply, /does not ask you to upload a license/)
})

test('role both can switch; rider and driver are fixed', () => {
  assert.equal(resolveRoleVariant({ role: 'both' }, 'driver'), 'driver')
  assert.equal(resolveRoleVariant({ role: 'both' }, 'rider'), 'rider')
  assert.equal(resolveRoleVariant({ role: 'driver' }, 'rider'), 'driver')
  assert.equal(resolveRoleVariant({ role: 'rider' }, 'driver'), 'rider')
  assert.match(contextSummary(rider), /no card on file/)
  assert.doesNotMatch(contextSummary(rider), /stripe_/)
})

test('support asks for detail, then prepares a confirmable draft', () => {
  const first = buildSupportTurn({
    messages: [{ role: 'user', content: 'I have a billing issue' }],
    context: rider,
    roleVariant: 'rider',
  })
  assert.equal(first.ticketDraft, null)
  assert.match(first.reply, /have not filed/i)
  assert.match(supportSystemPrompt('rider', rider, null), /must not say a ticket was created/i)

  const second = buildSupportTurn({
    messages: [
      { role: 'user', content: 'I have a billing issue' },
      { role: 'assistant', content: first.reply },
      { role: 'user', content: 'I was charged twice for the GSP deposit yesterday.' },
    ],
    context: rider,
    roleVariant: 'rider',
  })
  assert.equal(second.ticketDraft.ready, true)
  assert.equal(second.ticketDraft.category, 'billing')
  assert.match(second.ticketDraft.body, /Card on file: no/)
  assert.match(second.reply, /Nothing is filed/)
})

test('ticket draft parser and confirmation gate', () => {
  const parsed = extractTicketDraft('Look at the card.\nTICKET_DRAFT: {"category":"bug","subject":"Map froze","body":"Driver map froze on accept.","ready":true}')
  assert.equal(parsed.draft.category, 'bug')
  assert.equal(parsed.visible.includes('TICKET_DRAFT'), false)
  const rejected = validateTicket({ ...parsed.draft, roleVariant: 'driver', confirmed: false })
  assert.equal(rejected.ok, false)
  const accepted = validateTicket({ ...parsed.draft, roleVariant: 'driver', confirmed: true })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.ticket.roleVariant, 'driver')
})

test('actions stay on known screens', () => {
  const actions = sanitizeActions([
    { label: 'Bad', route: 'https://evil.example', params: {} },
    { label: 'Billing', route: 'account', params: { tab: 'billing', extra: 'nope' } },
    { label: 'Rate', route: 'rate', params: { trip: 'trip-1' } },
  ])
  assert.equal(actions.length, 2)
  assert.deepEqual(actions[0].params, { tab: 'billing' })
})

test('help and support HTTP handlers answer offline without keys', async () => {
  const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  delete process.env.OPENAI_API_KEY
  delete process.env.AI_GATEWAY_API_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  resetRateLimits()
  try {
    const helpRes = mockRes()
    await helpHandler({
      method: 'POST',
      headers: {},
      body: { roleVariant: 'rider', messages: [{ role: 'user', content: 'How do I schedule a GSP or CLT ride?' }] },
    }, helpRes)
    const help = JSON.parse(helpRes.body)
    assert.equal(help.source, 'offline')
    assert.match(help.reply, /GSP/)
    assert.equal(help.ticketDraft, null)

    const supportRes = mockRes()
    await supportHandler({
      method: 'POST',
      headers: {},
      body: {
        roleVariant: 'rider',
        messages: [{ role: 'user', content: 'The schedule screen crashed when I picked CLT yesterday afternoon.' }],
      },
    }, supportRes)
    const support = JSON.parse(supportRes.body)
    assert.equal(support.source, 'offline')
    assert.equal(support.ticketDraft.category, 'bug')
    assert.match(support.reply, /Nothing is filed/)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
})
