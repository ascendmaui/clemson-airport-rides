import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { INBOUND_MAILBOXES, INBOUND_PRODUCT_RULES, routeInboundBody, routeRecipients } from './inboundMail.js'

const HUMAN = ['support', 'drivers', 'riders', 'press', 'info']

test('each clemson mailbox maps to one role', () => {
  assert.equal(INBOUND_MAILBOXES.support.label, 'Customer help')
  assert.equal(INBOUND_MAILBOXES.support.kind, 'draft')
  assert.equal(INBOUND_MAILBOXES.drivers.label, 'Onboarding and driver questions')
  assert.equal(INBOUND_MAILBOXES.drivers.kind, 'draft')
  assert.equal(INBOUND_MAILBOXES.riders.label, 'Booking questions')
  assert.equal(INBOUND_MAILBOXES.press.label, 'Media and content requests')
  assert.equal(INBOUND_MAILBOXES.info.label, 'General triage')
  assert.equal(INBOUND_MAILBOXES.agents.kind, 'summary')
  assert.equal(INBOUND_MAILBOXES.agents.label, 'CI, deploy, and pull request alerts')
  assert.equal(INBOUND_MAILBOXES.noreply.kind, 'skip')
  assert.equal(INBOUND_MAILBOXES.noreply.address, 'noreply@clemsonrides.com')

  for (const local of HUMAN) {
    const box = INBOUND_MAILBOXES[local]
    assert.equal(box.address, `${local}@clemsonrides.com`)
    assert.match(box.system, /Standard, Wait & Save, Extra Comfort, and Carpool/)
    assert.match(box.system, /pre-authorization hold/)
    assert.match(box.system, /hold is released if the trip is canceled within policy/)
    assert.match(box.system, /John approves it before anyone sends it/)
    assert.doesNotMatch(box.system, /I have sent/)
  }
  assert.match(INBOUND_MAILBOXES.drivers.system, /Do not plan vehicle assignment/)
  assert.match(INBOUND_MAILBOXES.agents.system, /Do not draft a reply/)
  assert.equal(INBOUND_MAILBOXES.noreply.system, '')
  assert.match(INBOUND_PRODUCT_RULES, /A person drives every ride/)
})

test('routing follows the recipient and skips noreply', () => {
  assert.equal(routeRecipients(['Support <support@clemsonrides.com>']).local, 'support')
  assert.equal(routeRecipients([[{ address: 'drivers@clemsonrides.com' }]]).role, 'drivers')
  assert.equal(routeRecipients(['riders@clemsonrides.com']).label, 'Booking questions')
  assert.equal(routeRecipients(['press@clemsonrides.com']).kind, 'draft')
  assert.equal(routeRecipients(['info@clemsonrides.com']).role, 'info')
  assert.equal(routeRecipients(['agents@clemsonrides.com']).kind, 'summary')
  assert.equal(routeRecipients(['noreply@clemsonrides.com']).kind, 'skip')
  assert.equal(routeRecipients(['person@example.com']), null)
  assert.equal(routeRecipients(['other@clemsonrides.com']), null)

  const mixed = routeInboundBody({
    message: {
      to: ['noreply@clemsonrides.com', 'Ada <support@clemsonrides.com>'],
    },
  })
  assert.equal(mixed.local, 'support')

  const alerts = routeInboundBody({
    mailbox: 'agents@clemsonrides.com',
    message: { to: 'info@clemsonrides.com' },
  })
  assert.equal(alerts.local, 'info')

  const sendOnly = routeInboundBody({
    to: 'noreply@clemsonrides.com',
    mailbox: 'noreply@clemsonrides.com',
  })
  assert.equal(sendOnly.kind, 'skip')
})

test('mailbox copy has no send path', () => {
  const source = readFileSync(new URL('./inboundMail.js', import.meta.url), 'utf8')
  assert.equal(/resend|nodemailer|smtp|sendMail|api\.openai\.com|OPENAI_API_KEY/i.test(source), false)
})
