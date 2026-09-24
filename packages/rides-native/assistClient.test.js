import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAgentHttpResponse } from './assistClient.js'
import { createLostFoundReport } from './lostFoundClient.js'
import { sendTripMessage } from './tripMessagesClient.js'
import { ACCOUNT_DELETION_TICKET } from '../../shared/accountDeletion.js'
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from '../../shared/legalCopy.js'
import { DRIVER_EXPO_PROJECT, FROZEN_EXPO_SLUG, RIDER_EXPO_PROJECT } from '../../shared/productLinks.js'
import { validateTicket } from '../../server/supportAgent.js'
import { readFileSync } from 'node:fs'

test('help JSON replies stay structured for the rider app', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: null,
    text: JSON.stringify({ reply: 'Open Schedule.', source: 'offline', actions: [] }),
  })
  assert.equal(parsed.reply, 'Open Schedule.')
  assert.equal(parsed.source, 'offline')
})

test('streamed support text keeps the ticket draft out of the visible reply', () => {
  const meta = Buffer.from(JSON.stringify({
    source: 'llm',
    ticketDraft: {
      ready: true,
      category: 'billing',
      subject: 'Deposit charged twice',
      body: 'The airport deposit posted twice on one trip.',
    },
  })).toString('base64')
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    metaHeader: meta,
    text: 'I can file that.\nTICKET_DRAFT: {"ready":true,"category":"billing","subject":"Deposit charged twice","body":"The airport deposit posted twice on one trip."}',
  })
  assert.equal(parsed.reply, 'I can file that.')
  assert.equal(parsed.ticketDraft.category, 'billing')
  assert.equal(parsed.source, 'llm')
})

test('account deletion ticket matches the support validator', () => {
  const checked = validateTicket(ACCOUNT_DELETION_TICKET)
  assert.equal(checked.ok, true)
  assert.equal(checked.ticket.category, 'account')
})

test('legal copy is shared and the install links are the current apps', () => {
  assert.ok(PRIVACY_SECTIONS.some((section) => section.heading === 'Your choices'))
  assert.ok(TERMS_SECTIONS.some((section) => section.heading === 'Payments & earnings'))
  assert.match(RIDER_EXPO_PROJECT, /clemson-rides-rider/)
  assert.match(DRIVER_EXPO_PROJECT, /clemson-rides-driver/)
  assert.equal(FROZEN_EXPO_SLUG, 'clemson-airport-rides')
})

test('the marketing page does not install the frozen 1.0.0 binary', () => {
  const source = readFileSync(new URL('../../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ae9bb5b6|a9cfec15/)
  assert.doesNotMatch(source, /projects\/clemson-airport-rides\/builds/)
  assert.match(source, /Book a ride/)
  assert.match(source, /RIDER_EXPO_PROJECT/)
  assert.match(source, /DRIVER_EXPO_PROJECT/)
})

test('lost-and-found and ride chat reject empty text before any network call', async () => {
  await assert.rejects(
    () => createLostFoundReport({}, { description: 'x' }),
    /few words/,
  )
  await assert.rejects(
    () => sendTripMessage({}, { tripId: 'trip', body: '   ' }),
    /empty/,
  )
})
