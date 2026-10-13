import assert from 'node:assert/strict'
import test from 'node:test'
import { INBOUND_MAILBOXES } from './inboundMail.js'
import {
  OUTREACH_MAILING_ADDRESS,
  affiliateReportBody,
  agentKindsForInbound,
  agentSystem,
  isAgentKind,
  outreachSteps,
  withOutreachFooter,
} from './agentDrafts.js'

test('agent kinds stay on the three draft agents', () => {
  assert.equal(isAgentKind('marketing'), true)
  assert.equal(isAgentKind('affiliate'), true)
  assert.equal(isAgentKind('outreach'), true)
  assert.equal(isAgentKind('send'), false)
  assert.equal(isAgentKind('social'), false)
})

test('press and info always wake marketing, and tags wake the other agents', () => {
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.press, { subject: 'Interview' }), ['marketing'])
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.info, { subject: 'Hello' }), ['marketing'])
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.support, {
    subject: 'Card hold',
    tags: ['marketing'],
  }), ['marketing'])
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.support, {
    message: { subject: 'Affiliate question', labels: ['outreach'] },
  }), ['affiliate', 'outreach'])
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.drivers, {
    subject: 'Partner onboarding',
    headers: { 'x-clemson-tag': 'marketing' },
  }), ['marketing', 'outreach'])
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.agents, { subject: 'Deploy failed' }), [])
  assert.deepEqual(agentKindsForInbound(INBOUND_MAILBOXES.noreply, { subject: 'Affiliate onboarding' }), [])
  assert.deepEqual(agentKindsForInbound(null, { tags: ['marketing'] }), [])
})

test('outreach steps keep the Greenville footer on every email', () => {
  const steps = outreachSteps('Email 1\nSubject: Welcome\nHello\n\nEmail 2\nSubject: Next\nDetails\n\nEmail 3\nSubject: Go live\nReady')
  assert.deepEqual(steps.map((step) => step.slot), ['step-1', 'step-2', 'step-3'])
  for (const step of steps) {
    assert.match(step.body, /101 North Main Street, Greenville, SC 29601/)
  }
  const once = outreachSteps('A single note for partners.')
  assert.equal(once.length, 1)
  assert.equal(once[0].slot, 'sequence')
  assert.match(once[0].body, new RegExp(OUTREACH_MAILING_ADDRESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(withOutreachFooter(`Already listed\n${OUTREACH_MAILING_ADDRESS}`).split(OUTREACH_MAILING_ADDRESS).length, 2)
})

test('affiliate report uses live rows and does not invent counts when the read failed', () => {
  const live = affiliateReportBody({
    available: true,
    affiliates: [{ status: 'active', partner_type: 'student' }],
    ledger: [{ status: 'pending', amount_cents: 400, kind: 'referral_rider' }],
    attributions: [{ status: 'qualified', role: 'rider' }],
    clickCount: 3,
    rates: { rider_first_ride_cents: 400, rider_min_fare_cents: 1500, driver_first_trip_cents: 2000 },
  })
  assert.match(live, /Affiliates read: 1/)
  assert.match(live, /Clicks: 3/)
  assert.match(live, /Rates were read from affiliate_config/)
  assert.match(live, /does not pay anyone/)
  const missing = affiliateReportBody({ available: false })
  assert.match(missing, /Live affiliate counts were not available/)
  assert.doesNotMatch(missing, /Affiliates read:/)
})

test('agent prompts forbid social posts and name the mailing address', () => {
  for (const kind of ['marketing', 'affiliate', 'outreach']) {
    const system = agentSystem(kind)
    assert.match(system, /Do not post to social networks/)
    assert.match(system, /101 North Main Street, Greenville, SC 29601/)
    assert.match(system, /John approves this draft/)
  }
})
