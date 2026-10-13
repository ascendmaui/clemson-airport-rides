import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { sendAgreementForSignature } from './agreementMail.js'
import { sendApplicantNotice } from './applicantMail.js'
import { notifyAdminOfApplication } from './driverApproval.js'
import { sendResendOfferEmail } from './driverOfferChannels.js'
import { sendResendPromo } from './weeklyCouponDrop.js'
import { SUPPORT_EMAIL } from '../shared/productLinks.js'

const KEYS = ['RESEND_API_KEY', 'RESEND_FROM', 'SUPPORT_EMAIL', 'ADMIN_NOTIFY_EMAIL']

async function withEnv(env, fn) {
  const previous = {}
  for (const name of KEYS) previous[name] = process.env[name]
  for (const [name, value] of Object.entries(env)) {
    if (value == null) delete process.env[name]
    else process.env[name] = value
  }
  const previousFetch = globalThis.fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = previousFetch
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function captureFetch() {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ id: 'email_reply' }) }
  }
  return calls
}

describe('Resend Reply-To', { concurrency: false }, () => {
test('applicant notices set Reply-To from SUPPORT_EMAIL and leave From alone', async () => {
  const calls = captureFetch()
  await withEnv({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Clemson RIDES <offers@example.com>',
    SUPPORT_EMAIL: null,
  }, async () => {
    const result = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Hello' })
    assert.equal(result.emailed, true)
  })
  assert.equal(calls[0].body.from, 'Clemson RIDES <offers@example.com>')
  assert.equal(calls[0].body.reply_to, SUPPORT_EMAIL)
  assert.deepEqual(calls[0].body.to, ['ada@clemson.edu'])
})

test('SUPPORT_EMAIL overrides Reply-To without changing From', async () => {
  const calls = captureFetch()
  await withEnv({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Clemson RIDES <offers@example.com>',
    SUPPORT_EMAIL: 'desk@example.com',
  }, async () => {
    await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Hello' })
  })
  assert.equal(calls[0].body.from, 'Clemson RIDES <offers@example.com>')
  assert.equal(calls[0].body.reply_to, 'desk@example.com')
})

test('agreement, offer, promo, and admin application mail set Reply-To', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ id: 'email_1' }) }
  }
  await sendAgreementForSignature({
    isAdmin: true,
    profileId: 'driver-1',
    adminId: 'admin-1',
    to: 'ada@clemson.edu',
    packet: { html: '<p>agreement</p>', sha256: 'abc', version: 'v1' },
    env: {
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM: 'Clemson RIDES <rides@example.com>',
      SUPPORT_EMAIL: 'desk@example.com',
    },
    store: {
      async revokeUnusedLinks() {},
      async insertLink() { return { id: 'link-1' } },
      async insertSend() {},
    },
    createToken: () => ({ token: 'sign-token', tokenHash: 'hash' }),
    fetchImpl,
  })
  await sendResendPromo({
    to: 'ava@clemson.edu',
    subject: 'Friday',
    text: 'Code',
    env: { RESEND_API_KEY: 're_test_key', RESEND_FROM: 'Clemson RIDES <rides@example.com>' },
    fetchImpl,
  })
  await withEnv({
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'Clemson RIDES <offers@example.com>',
    SUPPORT_EMAIL: null,
    ADMIN_NOTIFY_EMAIL: 'ops-notify@example.com',
  }, async () => {
    globalThis.fetch = fetchImpl
    await sendResendOfferEmail({ to: 'driver@example.com', subject: 'Offer', text: 'A to B' }, { fetch: fetchImpl })
    await notifyAdminOfApplication({ profile: { full_name: 'Ada', email: 'ada@clemson.edu' } })
  })
  assert.equal(calls.length, 4)
  assert.equal(calls[0].body.from, 'Clemson RIDES <rides@example.com>')
  assert.equal(calls[0].body.reply_to, 'desk@example.com')
  assert.equal(calls[1].body.reply_to, SUPPORT_EMAIL)
  assert.equal(calls[1].body.from, 'Clemson RIDES <rides@example.com>')
  assert.equal(calls[2].body.reply_to, SUPPORT_EMAIL)
  assert.equal(calls[2].body.from, 'Clemson RIDES <offers@example.com>')
  assert.equal(calls[3].body.reply_to, SUPPORT_EMAIL)
  assert.equal(calls[3].body.from, 'Clemson RIDES <offers@example.com>')
  assert.deepEqual(calls[3].body.to, ['ops-notify@example.com'])
})
})
