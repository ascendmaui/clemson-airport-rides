import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyRewrites, createApp, loadRewrites } from './selfHost.mjs'
import handler, {
  bearerToken,
  forwardInboxNotify,
  normalizeInboundEvent,
  notifyTarget,
  webhookSecretMatches,
} from './inboundAgentMail.js'

const SECRET = 'hostinger-webhook-secret-not-real'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function memoryStore() {
  const rows = []
  function find(column, value) {
    return rows.find((existing) => existing[column] === value) || null
  }
  return {
    rows,
    from(table) {
      assert.equal(table, 'inbound_agent_mail')
      return {
        insert(row) {
          return {
            select() {
              return {
                async maybeSingle() {
                  if (rows.some((existing) => existing.message_id === row.message_id)) {
                    return {
                      data: null,
                      error: {
                        code: '23505',
                        message: 'duplicate key value violates unique constraint "inbound_agent_mail_message_id_key"',
                      },
                    }
                  }
                  const stored = {
                    ...row,
                    id: `id-${rows.length + 1}`,
                    received_at: '2026-10-13T12:00:00.000Z',
                  }
                  rows.push(stored)
                  return { data: { id: stored.id, received_at: stored.received_at }, error: null }
                },
              }
            },
          }
        },
        select() {
          return {
            eq(column, value) {
              return {
                async maybeSingle() {
                  return { data: find(column, value), error: null }
                },
              }
            },
          }
        },
        update(patch) {
          return {
            eq(column, value) {
              return {
                select() {
                  return {
                    async maybeSingle() {
                      const row = find(column, value)
                      if (!row) return { data: null, error: null }
                      Object.assign(row, patch)
                      return { data: row, error: null }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

async function call(req, deps) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, json, headers: res.headers }
}

test('bearer comparison rejects a missing, wrong, or placeholder secret', () => {
  assert.equal(bearerToken('Bearer ' + SECRET), SECRET)
  assert.equal(bearerToken('bearer "' + SECRET + '"'), SECRET)
  assert.equal(webhookSecretMatches(SECRET, SECRET), true)
  assert.equal(webhookSecretMatches(SECRET, SECRET + 'x'), false)
  assert.equal(webhookSecretMatches(SECRET, ''), false)
  assert.equal(webhookSecretMatches('', SECRET), false)
  assert.equal(webhookSecretMatches('whsec_placeholder', 'whsec_placeholder'), false)
  assert.equal(webhookSecretMatches(SECRET, 'not-the-secret'), false)
})

test('a request without the Hostinger bearer is 401 and does not store', async () => {
  const sb = memoryStore()
  const missing = await call({ method: 'POST', body: { subject: 'Hi' } }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb })
  assert.equal(missing.status, 401)
  assert.equal(missing.json.error, 'Unauthorized')
  assert.equal(sb.rows.length, 0)

  const queryOnly = await call({
    method: 'POST',
    url: `/api/inbound-mail/hostinger?secret=${SECRET}`,
    headers: { 'x-hostinger-webhook-secret': SECRET },
    body: { subject: 'Hi' },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb })
  assert.equal(queryOnly.status, 401)
  assert.equal(sb.rows.length, 0)

  const unset = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { subject: 'Hi' },
  }, { env: {}, sb })
  assert.equal(unset.status, 401)
})

test('GET is not a webhook and does not store', async () => {
  const sb = memoryStore()
  const result = await call({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET },
    sb,
  })
  assert.equal(result.status, 405)
  assert.equal(result.headers.allow, 'POST')
  assert.equal(sb.rows.length, 0)
})

test('a verified event is stored once and a retry does not notify again', async () => {
  const sb = memoryStore()
  const seen = []
  const deps = {
    env: {
      HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
      AGENT_INBOX_NOTIFY_URL: 'https://agents.example/inbox',
    },
    sb,
    fetch: async (url, init) => {
      seen.push({ url, init })
      return { ok: true, status: 202 }
    },
  }
  const body = {
    event: 'message.received',
    mailbox: 'agents@clemsonrides.com',
    message: {
      messageId: '<ride-1@mail.example>',
      from: { name: 'Ada Lovelace', address: 'ada@example.com' },
      to: [{ name: 'Agents', address: 'agents@clemsonrides.com' }],
      subject: 'Airport tonight',
      text: 'Can I book a ride after the game?',
      status: 'should-not-stick',
    },
  }
  const first = await call({ method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body }, deps)
  assert.equal(first.status, 200)
  assert.deepEqual(first.json, { ok: true })
  assert.equal(sb.rows.length, 1)
  assert.equal(sb.rows[0].message_id, '<ride-1@mail.example>')
  assert.equal(sb.rows[0].from, 'Ada Lovelace <ada@example.com>')
  assert.equal(sb.rows[0].to, 'Agents <agents@clemsonrides.com>')
  assert.equal(sb.rows[0].subject, 'Airport tonight')
  assert.equal(sb.rows[0].snippet, 'Can I book a ride after the game?')
  assert.equal(sb.rows[0].status, 'new')
  assert.equal(sb.rows[0].raw.event, 'message.received')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://agents.example/inbox')
  assert.equal(seen[0].init.method, 'POST')
  assert.equal(seen[0].init.headers.authorization, undefined)
  const forwarded = JSON.parse(seen[0].init.body)
  assert.equal(forwarded.source, 'hostinger-agentic-mail')
  assert.equal(forwarded.message_id, '<ride-1@mail.example>')
  assert.equal(JSON.stringify(forwarded).includes(SECRET), false)

  const second = await call({ method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body }, deps)
  assert.equal(second.status, 200)
  assert.equal(sb.rows.length, 1)
  assert.equal(seen.length, 1)
})

test('an unset notify URL does not call fetch', async () => {
  const sb = memoryStore()
  let called = false
  const result = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      event: 'message.received',
      mailbox: 'agents@clemsonrides.com',
      message: {
        from: 'Ada <ada@example.com>',
        subject: 'Order #1042: where is my package?',
        thread_id: 'thr_8fk2m01x',
      },
    },
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET },
    sb,
    fetch: async () => {
      called = true
      throw new Error('fetch should not run')
    },
  })
  assert.equal(result.status, 200)
  assert.equal(called, false)
  assert.equal(sb.rows[0].from, 'Ada <ada@example.com>')
  assert.equal(sb.rows[0].to, 'agents@clemsonrides.com')
  assert.equal(sb.rows[0].subject, 'Order #1042: where is my package?')
  assert.match(sb.rows[0].message_id, /^sha256:[a-f0-9]{64}$/)
})

test('a notify failure still returns 200 and a blank URL stays off', async () => {
  const sb = memoryStore()
  const failed = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message_id: 'msg-fail', sender: 'ada@example.com', subject: 'Hi', truncated: 'Hello there' },
  }, {
    env: {
      HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
      AGENT_INBOX_NOTIFY_URL: 'https://agents.example/inbox',
    },
    sb,
    fetch: async () => {
      throw new Error('downstream down')
    },
  })
  assert.equal(failed.status, 200)
  assert.equal(sb.rows[0].from, 'ada@example.com')
  assert.equal(sb.rows[0].snippet, 'Hello there')

  const blank = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message_id: 'msg-blank', subject: 'Next' },
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, AGENT_INBOX_NOTIFY_URL: '   ' },
    sb,
    fetch: async () => {
      throw new Error('fetch should not run')
    },
  })
  assert.equal(blank.status, 200)
  assert.equal(notifyTarget('javascript:alert(1)'), null)
  assert.equal(notifyTarget(''), null)
})

test('a slow notify is aborted and the webhook still returns 200', async () => {
  const sb = memoryStore()
  const started = Date.now()
  const result = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message_id: 'msg-slow', subject: 'Slow' },
  }, {
    env: {
      HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
      AGENT_INBOX_NOTIFY_URL: 'https://agents.example/inbox',
    },
    sb,
    notifyTimeoutMs: 40,
    fetch: (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }),
  })
  assert.equal(result.status, 200)
  assert.ok(Date.now() - started < 1000)
  assert.equal(sb.rows.length, 1)
})

test('a payload URL is not used as the notify target', async () => {
  const sb = memoryStore()
  const seen = []
  await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      message_id: 'msg-url',
      subject: 'Ignore my link',
      notify_url: 'https://evil.example/steal',
      url: 'https://evil.example/steal',
    },
  }, {
    env: {
      HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
      AGENT_INBOX_NOTIFY_URL: 'https://agents.example/inbox',
    },
    sb,
    fetch: async (url) => {
      seen.push(url)
      return { ok: true, status: 200 }
    },
  })
  assert.deepEqual(seen, ['https://agents.example/inbox'])
})

test('storage failure is retryable and a missing service client is 503', async () => {
  const broken = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: null, error: { code: '08006', message: 'connection failure' } }
                },
              }
            },
          }
        },
      }
    },
  }
  const failed = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message_id: 'msg-db', subject: 'Hi' },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb: broken })
  assert.equal(failed.status, 500)
  assert.equal(failed.json.error, 'Could not store inbound mail')

  const unavailable = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message_id: 'msg-db' },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb: null })
  assert.equal(unavailable.status, 503)
})

test('documented Hostinger shapes map into the stored columns', () => {
  const marketing = normalizeInboundEvent({
    event: 'message.received',
    mailbox: 'agent@yourdomain.com',
    message: {
      from: 'customer@example.com',
      subject: 'Order #1042: where is my package?',
      thread_id: 'thr_8fk2m01x',
    },
  })
  assert.equal(marketing.from, 'customer@example.com')
  assert.equal(marketing.to, 'agent@yourdomain.com')
  assert.equal(marketing.subject, 'Order #1042: where is my package?')
  assert.match(marketing.message_id, /^sha256:/)

  const again = normalizeInboundEvent({
    event: 'message.received',
    mailbox: 'agent@yourdomain.com',
    message: {
      from: 'customer@example.com',
      subject: 'Order #1042: where is my package?',
      thread_id: 'thr_8fk2m01x',
    },
  })
  assert.equal(again.message_id, marketing.message_id)

  const otherThread = normalizeInboundEvent({
    event: 'message.received',
    mailbox: 'agent@yourdomain.com',
    message: {
      from: 'customer@example.com',
      subject: 'Different note',
      thread_id: 'thr_8fk2m01x',
    },
  })
  assert.notEqual(otherThread.message_id, marketing.message_id)
})

test('the receiver source never sends mail', () => {
  const source = [
    readFileSync(new URL('./inboundAgentMail.js', import.meta.url), 'utf8'),
    readFileSync(new URL('./inboundDraft.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../api/inbound-mail.js', import.meta.url), 'utf8'),
  ].join('\n')
  assert.equal(/resend|nodemailer|smtp|sendMail|api\.resend\.com|OPENAI_API_KEY/i.test(source), false)
  assert.match(source, /does not send email/i)
  assert.match(source, /Authorization: Bearer/)
  assert.match(source, /integrate\.api\.nvidia\.com/)
  assert.match(source, /api\.openai\.com/)
})

test('notify helper ignores a non-http URL and posts JSON otherwise', async () => {
  assert.equal((await forwardInboxNotify('notaurl', { ok: 1 }, async () => {
    throw new Error('no')
  })).forwarded, false)
  let body = ''
  const result = await forwardInboxNotify('http://127.0.0.1:9/inbox', { hello: 'agent' }, async (_url, init) => {
    body = init.body
    return { ok: true, status: 204 }
  })
  assert.equal(result.forwarded, true)
  assert.equal(body, JSON.stringify({ hello: 'agent' }))
})

test('a mailbox secret only opens that mailbox', async () => {
  const sb = memoryStore()
  const env = {
    HOSTINGER_MAIL_WEBHOOK_SECRETS: {
      support: 'support-secret',
      drivers: 'drivers-secret',
    },
    HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
  }
  const wrong = await call({
    method: 'POST',
    headers: { authorization: 'Bearer drivers-secret' },
    body: { message: { messageId: '<wrong>', to: 'support@clemsonrides.com', subject: 'Help' } },
  }, { env, sb, draftFetch: async () => { throw new Error('should not draft') } })
  assert.equal(wrong.status, 401)
  assert.equal(sb.rows.length, 0)

  const globalForRiders = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message: { messageId: '<riders>', to: 'riders@clemsonrides.com', subject: 'Book' } },
  }, { env, sb, draftFetch: async () => { throw new Error('no key') } })
  assert.equal(globalForRiders.status, 200)
  assert.equal(sb.rows[0].role, 'riders')
  assert.equal(sb.rows[0].status, 'new')
})

test('noreply is never stored, drafted, or forwarded', async () => {
  const sb = memoryStore()
  let drafted = false
  let notified = false
  const result = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      message: {
        messageId: '<receipt>',
        to: 'noreply@clemsonrides.com',
        subject: 'Receipt',
        text: 'Thanks for riding.',
      },
    },
  }, {
    env: {
      HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
      AGENT_INBOX_NOTIFY_URL: 'https://n8n.example/hook',
      NVIDIA_API_KEY: 'nvapi-test-key',
    },
    sb,
    fetch: async () => {
      notified = true
      return { ok: true, status: 200 }
    },
    draftFetch: async () => {
      drafted = true
      throw new Error('should not draft')
    },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.skipped, true)
  assert.equal(sb.rows.length, 0)
  assert.equal(drafted, false)
  assert.equal(notified, false)
})

test('support mail stores a draft for approval and agents mail is summary only', async () => {
  const sb = memoryStore()
  const calls = []
  const env = {
    HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
    NVIDIA_API_KEY: 'nvapi-test-key',
    OPENAI_API_KEY: 'sk-should-not-be-used',
    AGENT_INBOX_NOTIFY_URL: 'https://n8n.example/hook',
  }
  const support = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      message: {
        messageId: '<help@mail>',
        from: 'ada@example.com',
        to: 'support@clemsonrides.com',
        subject: 'Card hold',
        text: 'Was I charged a deposit?',
      },
    },
  }, {
    env,
    sb,
    fetch: async (url, init) => {
      calls.push({ kind: 'notify', url, init })
      return { ok: true, status: 200 }
    },
    draftFetch: async (url, init) => {
      calls.push({ kind: 'draft', url, init })
      const prompt = JSON.parse(init.body)
      const reply = prompt.messages[0].content.includes('do not draft a reply')
        ? 'CI failed on main.'
        : 'There is no deposit. Stripe places a pre-authorization hold.'
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: reply } }] }
        },
      }
    },
  })
  assert.equal(support.status, 200)
  assert.equal(sb.rows[0].mailbox, 'support@clemsonrides.com')
  assert.equal(sb.rows[0].role, 'support')
  assert.equal(sb.rows[0].status, 'draft_ready')
  assert.match(sb.rows[0].draft_reply, /pre-authorization hold/)
  assert.equal(sb.rows[0].summary, null)
  const draft = calls.find((item) => item.kind === 'draft')
  assert.equal(draft.url, 'https://integrate.api.nvidia.com/v1/chat/completions')
  assert.equal(draft.init.headers.authorization, 'Bearer nvapi-test-key')
  const prompt = JSON.parse(draft.init.body)
  assert.equal(prompt.model, 'openai/gpt-oss-120b')
  assert.match(prompt.messages[0].content, /customer help/i)
  assert.match(prompt.messages[0].content, /There is no deposit/)
  const notify = JSON.parse(calls.find((item) => item.kind === 'notify').init.body)
  assert.equal(notify.send, false)
  assert.equal(notify.draft_reply, sb.rows[0].draft_reply)
  assert.equal(calls.some((item) => String(item.url).includes('api.openai.com')), false)

  const agents = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      message: {
        messageId: '<ci@mail>',
        to: 'agents@clemsonrides.com',
        subject: 'Deploy failed',
        text: 'The production build failed.',
      },
    },
  }, {
    env,
    sb,
    fetch: async () => ({ ok: true, status: 200 }),
    draftFetch: async (_url, init) => {
      const prompt = JSON.parse(init.body)
      assert.match(prompt.messages[0].content, /Do not draft a reply/)
      assert.equal(prompt.messages[0].content.includes('John approves it before anyone sends it'), false)
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: 'Production build failed. No reply needed.' } }] }
        },
      }
    },
  })
  assert.equal(agents.status, 200)
  const alert = sb.rows.find((row) => row.message_id === '<ci@mail>')
  assert.equal(alert.role, 'agents')
  assert.equal(alert.status, 'summarized')
  assert.equal(alert.draft_reply, null)
  assert.match(alert.summary, /Production build failed/)
})

test('the draft client refuses a pay-per-call OpenAI host', async () => {
  const sb = memoryStore()
  let drafted = false
  const result = await call({
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      message: {
        messageId: '<blocked>',
        to: 'press@clemsonrides.com',
        subject: 'Interview',
        text: 'Can we talk tomorrow?',
      },
    },
  }, {
    env: {
      HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET,
      NVIDIA_API_KEY: 'nvapi-test-key',
      OPENAI_API_KEY: 'sk-should-not-be-used',
      AGENT_DRAFT_BASE_URL: 'https://api.openai.com/v1',
    },
    sb,
    draftFetch: async () => {
      drafted = true
      throw new Error('should not call')
    },
  })
  assert.equal(result.status, 200)
  assert.equal(drafted, false)
  assert.equal(sb.rows[0].status, 'new')
  assert.equal(sb.rows[0].draft_reply, null)
})

function hit(port, pathName, method, headers, body) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    outgoing.on('error', reject)
    if (body) outgoing.write(body)
    outgoing.end()
  })
}

test('the public webhook path is rewritten and rejects a missing bearer', async () => {
  const rules = loadRewrites(path.join(root, 'vercel.json'))
  const rewritten = applyRewrites('/api/inbound-mail/hostinger', '', rules)
  assert.equal(rewritten.pathname, '/api/inbound-mail')

  const listener = await createApp({
    root,
    apiDir: path.join(root, 'api'),
    vercelPath: path.join(root, 'vercel.json'),
    log() {},
  })
  const server = createServer(listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const previousSecret = process.env.HOSTINGER_MAIL_WEBHOOK_SECRET
  delete process.env.HOSTINGER_MAIL_WEBHOOK_SECRET
  try {
    const missing = await hit(port, '/api/inbound-mail/hostinger', 'POST', { 'content-type': 'application/json' }, '{}')
    assert.equal(missing.status, 401)
    assert.equal(JSON.parse(missing.text).error, 'Unauthorized')
    const wrong = await hit(port, '/api/inbound-mail/hostinger', 'POST', {
      'content-type': 'application/json',
      authorization: 'Bearer not-the-secret',
    }, '{}')
    assert.equal(wrong.status, 401)
    const get = await hit(port, '/api/inbound-mail', 'GET')
    assert.equal(get.status, 405)
  } finally {
    if (previousSecret === undefined) delete process.env.HOSTINGER_MAIL_WEBHOOK_SECRET
    else process.env.HOSTINGER_MAIL_WEBHOOK_SECRET = previousSecret
    await new Promise((resolve, closeReject) => {
      server.close((error) => (error ? closeReject(error) : resolve()))
    })
  }
})
