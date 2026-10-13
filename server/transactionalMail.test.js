import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { SUPPORT_EMAIL } from '../shared/productLinks.js'
import { TRANSACTIONAL_KINDS, transactionalEmail } from '../shared/transactionalEmail.js'
import { emailDriverDecision, sendTransactionalEmail } from './transactionalMail.js'

const trip = {
  id: 'trip-1',
  pickup_label: 'Tillman Hall',
  dropoff_label: 'GSP',
  scheduled_at: '2026-10-13T18:00:00Z',
  fare_cents: 4500,
  tip_cents: 500,
  wait_fee_cents: 0,
}

describe('transactional mail', { concurrency: false }, () => {
test('transactional copy includes the support mailbox and pre-authorization language', () => {
  const confirmation = transactionalEmail('ride_confirmation', trip)
  const receipt = transactionalEmail('receipt', trip)
  const cancellation = transactionalEmail('cancellation', { ...trip, reason: 'Plans changed' })
  const approved = transactionalEmail('driver_approved', { name: 'Ada' })
  const declined = transactionalEmail('driver_declined', { name: 'Ada', reason: 'Insurance expired' })
  const payout = transactionalEmail('payout_notice', { amountCents: 3600, tripId: 'trip-1' })
  for (const message of [confirmation, receipt, cancellation, approved, declined, payout]) {
    assert.match(message.text, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')))
    assert.equal(message.text.includes('Tesla'), false)
    assert.equal(/self-driving/i.test(message.text), false)
  }
  assert.match(confirmation.text, /pre-authorized/)
  assert.match(confirmation.text, /hold, not a deposit/)
  assert.equal(/\bdeposit\b/i.test(confirmation.text.replace('not a deposit', '')), false)
  assert.match(confirmation.text, /Tillman Hall/)
  assert.match(confirmation.text, /2026-10-13T18:00:00Z/)
  assert.match(receipt.text, /Fare: \$45\.00/)
  assert.match(receipt.text, /Total: \$50\.00/)
  assert.match(receipt.text, /hold is not a deposit/)
  assert.match(cancellation.text, /pre-authorization hold/)
  assert.match(cancellation.text, /Plans changed/)
  assert.match(approved.text, /approved/)
  assert.match(approved.subject, /approved/)
  assert.match(declined.text, /could not approve/)
  assert.match(declined.text, /Insurance expired/)
  assert.match(payout.text, /\$36\.00/)
  assert.match(payout.text, /trip-1/)
  assert.equal(transactionalEmail('unknown', trip), null)
  assert.deepEqual([...TRANSACTIONAL_KINDS], [
    'ride_confirmation',
    'receipt',
    'cancellation',
    'driver_approved',
    'driver_declined',
    'payout_notice',
  ])
})

test('transactional send posts through the Resend helper with Reply-To', async () => {
  const previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  }
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.RESEND_FROM = 'Clemson RIDES <offers@example.com>'
  delete process.env.SUPPORT_EMAIL
  const calls = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ id: 'email_tx' }) }
  }
  try {
    const sent = await sendTransactionalEmail({ kind: 'ride_confirmation', to: 'ada@clemson.edu', ctx: trip })
    assert.equal(sent.emailed, true)
    assert.equal(sent.id, 'email_tx')
    assert.equal(calls[0].url, 'https://api.resend.com/emails')
    assert.equal(calls[0].body.from, 'Clemson RIDES <offers@example.com>')
    assert.equal(calls[0].body.reply_to, SUPPORT_EMAIL)
    assert.match(calls[0].body.text, /pre-authorized/)
    const missing = await sendTransactionalEmail({ kind: 'not-a-kind', to: 'ada@clemson.edu' })
    assert.equal(missing.emailed, false)
    assert.equal(missing.reason, 'unknown_kind')
    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = previousFetch
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('driver approval and decline mail the applicant and survive a sender failure', async () => {
  const sent = []
  const approved = await emailDriverDecision({
    to: 'ada@clemson.edu',
    decision: 'approve',
    name: 'Ada',
    send: async (payload) => {
      sent.push(payload)
      return { emailed: true, id: 'ok' }
    },
  })
  const declined = await emailDriverDecision({
    to: 'ada@clemson.edu',
    decision: 'reject',
    reason: 'Plate missing',
    name: 'Ada',
    send: async (payload) => {
      sent.push(payload)
      return { emailed: true }
    },
  })
  const broken = await emailDriverDecision({
    to: 'ada@clemson.edu',
    decision: 'approve',
    send: async () => { throw new Error('resend down') },
  })
  const unknown = await emailDriverDecision({ to: 'ada@clemson.edu', decision: 'hold' })
  assert.equal(approved.emailed, true)
  assert.equal(declined.emailed, true)
  assert.match(sent[0].subject, /approved/)
  assert.match(sent[1].text, /Plate missing/)
  assert.equal(broken.emailed, false)
  assert.match(broken.reason, /resend down/)
  assert.equal(unknown.reason, 'unknown_decision')
  const review = readFileSync(new URL('../api/admin-drivers.js', import.meta.url), 'utf8')
  assert.match(review, /emailDriverDecision\(/)
  assert.match(review, /select\('id, role, email, full_name'\)/)
})
})
