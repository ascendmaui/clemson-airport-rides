import assert from 'node:assert/strict'
import test from 'node:test'
import { sendApplicantNotice } from '../server/applicantMail.js'

const FAKE_KEY = 'test-resend-key'

async function withMailEnv(env, fn) {
  const previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
  }
  const previousFetch = globalThis.fetch
  for (const [name, value] of Object.entries(env)) {
    if (value == null) delete process.env[name]
    else process.env[name] = value
  }
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

test('missing applicant address does not call Resend', async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    throw new Error('fetch should not run')
  }
  await withMailEnv({ RESEND_API_KEY: FAKE_KEY, RESEND_FROM: 'rides@clemson.edu' }, async () => {
    const result = await sendApplicantNotice({ to: '', subject: 'Update', text: 'Bring your license.' })
    assert.equal(result.emailed, false)
    assert.equal(result.stub, 'Bring your license.')
    assert.match(result.todo, /no email/)
    assert.equal(called, false)
  })
})

test('a missing or placeholder key keeps the message on the application', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch should not run')
  }
  await withMailEnv({ RESEND_API_KEY: null, RESEND_FROM: 'rides@clemson.edu' }, async () => {
    const result = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Hello' })
    assert.equal(result.emailed, false)
    assert.equal(result.stub, 'Hello')
    assert.match(result.todo, /RESEND_API_KEY/)
  })
  await withMailEnv({ RESEND_API_KEY: 'placeholder-key', RESEND_FROM: 'rides@clemson.edu' }, async () => {
    const result = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Hello' })
    assert.equal(result.emailed, false)
    assert.match(result.todo, /RESEND_FROM/)
  })
  await withMailEnv({ RESEND_API_KEY: FAKE_KEY, RESEND_FROM: '' }, async () => {
    const result = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Hello' })
    assert.equal(result.emailed, false)
    assert.equal(result.stub, 'Hello')
  })
})

test('a successful Resend response marks the notice emailed and drops the stub', async () => {
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ id: 'email_test_1' }) }
  }
  await withMailEnv({ RESEND_API_KEY: FAKE_KEY, RESEND_FROM: 'Clemson RIDES <rides@clemson.edu>' }, async () => {
    const result = await sendApplicantNotice({
      to: 'ada@clemson.edu',
      subject: 'Application update',
      text: 'An admin left a note.',
    })
    assert.equal(result.emailed, true)
    assert.equal(result.id, 'email_test_1')
    assert.equal(result.stub, null)
    assert.equal(result.todo, null)
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.resend.com/emails')
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`)
  const body = JSON.parse(seen[0].init.body)
  assert.deepEqual(body.to, ['ada@clemson.edu'])
  assert.equal(body.subject, 'Application update')
  assert.equal(body.text, 'An admin left a note.')
  assert.equal(body.from, 'Clemson RIDES <rides@clemson.edu>')
})

test('a Resend error status keeps the stub and records the status', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ message: 'rejected' }),
  })
  await withMailEnv({ RESEND_API_KEY: FAKE_KEY, RESEND_FROM: 'rides@clemson.edu' }, async () => {
    const result = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Still here' })
    assert.equal(result.emailed, false)
    assert.equal(result.stub, 'Still here')
    assert.match(result.todo, /422/)
    assert.match(result.todo, /rejected/)
  })
})

test('a thrown Resend request keeps the stub', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down')
  }
  await withMailEnv({ RESEND_API_KEY: FAKE_KEY, RESEND_FROM: 'rides@clemson.edu' }, async () => {
    const result = await sendApplicantNotice({ to: 'ada@clemson.edu', subject: 'Update', text: 'Queued locally' })
    assert.equal(result.emailed, false)
    assert.equal(result.stub, 'Queued locally')
    assert.match(result.todo, /network down/)
  })
})
