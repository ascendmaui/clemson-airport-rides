import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import handler from './inboundAgentMail.js'
import scheduleHandler from './agentDrafts.js'
import { OUTREACH_MAILING_ADDRESS } from '../shared/copy/agentDrafts.js'

const SECRET = 'hostinger-webhook-secret-not-real'

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

function memoryDb(seed = {}) {
  const tables = {
    inbound_agent_mail: [],
    agent_drafts: [],
    affiliates: [],
    affiliate_ledger: [],
    affiliate_attributions: [],
    affiliate_clicks: [],
    affiliate_config: [],
    ...seed,
  }
  const ops = []
  return {
    tables,
    ops,
    from(table) {
      if (!tables[table]) tables[table] = []
      const state = { op: null, filters: [], payload: null, options: null }
      let pending = null
      const api = {
        select(_columns, options) {
          if (state.op !== 'insert' && state.op !== 'update') state.op = 'select'
          state.options = options || null
          return api
        },
        insert(payload) {
          state.op = 'insert'
          state.payload = payload
          return api
        },
        update(payload) {
          state.op = 'update'
          state.payload = payload
          return api
        },
        delete(payload) {
          state.op = 'delete'
          state.payload = payload
          return api
        },
        eq(column, value) {
          state.filters.push({ column, value })
          return api
        },
        order() { return api },
        limit() { return api },
        maybeSingle() { return finish(true) },
        then(onFulfilled, onRejected) { return finish(false).then(onFulfilled, onRejected) },
      }
      function finish(single) {
        if (!pending) pending = Promise.resolve(execute(single))
        return pending
      }
      function execute(single) {
        const op = state.op || 'select'
        ops.push({ table, op })
        const rows = tables[table]
        const match = (row) => state.filters.every((filter) => row[filter.column] === filter.value)
        if (op === 'delete' || (op === 'update' && table.startsWith('affiliate'))) {
          return { data: null, error: { message: `${op} refused` } }
        }
        if (op === 'insert') {
          const duplicateMail = table === 'inbound_agent_mail'
            && rows.some((row) => row.message_id === state.payload.message_id)
          const duplicateDraft = table === 'agent_drafts'
            && state.payload.message_id
            && rows.some((row) => row.kind === state.payload.kind && row.message_id === state.payload.message_id && row.slot === state.payload.slot)
          if (duplicateMail || duplicateDraft) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } }
          }
          const stored = {
            id: `${table}-${rows.length + 1}`,
            created_at: '2026-10-13T12:00:00.000Z',
            received_at: '2026-10-13T12:00:00.000Z',
            ...state.payload,
          }
          rows.push(stored)
          return { data: single ? stored : [stored], error: null }
        }
        if (op === 'update') {
          const found = rows.filter(match)
          for (const row of found) Object.assign(row, state.payload)
          return { data: single ? (found[0] || null) : found, error: null }
        }
        if (state.options?.head) return { count: rows.filter(match).length, data: null, error: null }
        const found = rows.filter(match)
        return { data: single ? (found[0] || null) : found, error: null }
      }
      return api
    },
  }
}

async function call(fn, req, deps) {
  const res = mockRes()
  await fn({ headers: {}, ...req }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers }
}

function model(contentFor) {
  const calls = []
  return {
    calls,
    async draftFetch(url, init) {
      calls.push({ url, init, prompt: JSON.parse(init.body) })
      const system = calls.at(-1).prompt.messages[0].content
      const content = contentFor(system, calls.at(-1).prompt)
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content } }] }
        },
      }
    },
  }
}

test('schedule routes reject a missing or query-string secret', async () => {
  const sb = memoryDb()
  const missing = await call(scheduleHandler, {
    method: 'POST',
    url: '/api/agents?kind=marketing',
    body: {},
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb })
  assert.equal(missing.status, 401)
  assert.equal(sb.tables.agent_drafts.length, 0)

  const query = await call(scheduleHandler, {
    method: 'POST',
    url: `/api/agents?kind=outreach&secret=${SECRET}`,
    body: { send: true },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb })
  assert.equal(query.status, 401)
  assert.equal(sb.tables.agent_drafts.length, 0)

  const get = await call(scheduleHandler, {
    method: 'GET',
    url: '/api/agents?kind=affiliate',
    headers: { authorization: `Bearer ${SECRET}` },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb })
  assert.equal(get.status, 405)
})

test('scheduled marketing stores one draft and does not send', async () => {
  const sb = memoryDb()
  const ai = model(() => 'Campus week campaign. Invite riders to book a Standard ride.')
  const result = await call(scheduleHandler, {
    method: 'POST',
    url: '/api/agents?kind=marketing',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { brief: 'Fall campus week', send: true },
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key', OPENAI_API_KEY: 'sk-ignored' },
    sb,
    draftFetch: ai.draftFetch,
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.send, false)
  assert.equal(result.json.kind, 'marketing')
  assert.equal(result.json.drafts.length, 1)
  assert.equal(sb.tables.agent_drafts.length, 1)
  assert.equal(sb.tables.agent_drafts[0].kind, 'marketing')
  assert.equal(sb.tables.agent_drafts[0].status, 'draft_ready')
  assert.equal(sb.tables.agent_drafts[0].source, 'schedule')
  assert.match(sb.tables.agent_drafts[0].body, /Campus week campaign/)
  assert.match(sb.tables.agent_drafts[0].body, /101 North Main Street, Greenville, SC 29601/)
  assert.equal(ai.calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions')
  assert.equal(ai.calls[0].init.headers.authorization, 'Bearer nvapi-test-key')
  assert.equal(ai.calls.some((item) => String(item.url).includes('api.openai.com')), false)
})

test('scheduled outreach stores the onboarding sequence with the footer', async () => {
  const sb = memoryDb()
  const ai = model(() => 'Email 1\nSubject: Welcome aboard\nGlad you are here.\n\nEmail 2\nSubject: Your link\nShare the partner page.\n\nEmail 3\nSubject: First referral\nTell us when you are ready.')
  const result = await call(scheduleHandler, {
    method: 'POST',
    url: '/api/agents?kind=outreach',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {},
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key' },
    sb,
    draftFetch: ai.draftFetch,
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.send, false)
  assert.deepEqual(sb.tables.agent_drafts.map((row) => row.slot), ['step-1', 'step-2', 'step-3'])
  for (const row of sb.tables.agent_drafts) {
    assert.equal(row.kind, 'outreach')
    assert.match(row.body, new RegExp(OUTREACH_MAILING_ADDRESS))
  }
})

test('scheduled affiliate reads rows and drafts a report plus recruitment email', async () => {
  const sb = memoryDb({
    affiliates: [{ status: 'active', partner_type: 'campus_org' }, { status: 'pending', partner_type: 'student' }],
    affiliate_ledger: [{ status: 'pending', amount_cents: 400, kind: 'referral_rider' }],
    affiliate_attributions: [{ status: 'qualified', role: 'rider' }],
    affiliate_clicks: [{ id: 1 }, { id: 2 }],
    affiliate_config: [{ key: 'rates', value: { rider_first_ride_cents: 400, rider_min_fare_cents: 1500, driver_first_trip_cents: 2000 } }],
  })
  const ai = model(() => 'Join the partner program and share your link.')
  const result = await call(scheduleHandler, {
    method: 'POST',
    url: '/api/agents?kind=affiliate',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { brief: 'Recruit campus groups' },
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key' },
    sb,
    draftFetch: ai.draftFetch,
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.send, false)
  assert.deepEqual(sb.tables.agent_drafts.map((row) => row.slot), ['report', 'recruitment'])
  assert.match(sb.tables.agent_drafts[0].body, /Affiliates read: 2/)
  assert.match(sb.tables.agent_drafts[0].body, /Clicks: 2/)
  assert.match(sb.tables.agent_drafts[1].body, /Join the partner program/)
  assert.match(sb.tables.agent_drafts[1].body, /101 North Main Street, Greenville, SC 29601/)
  const affiliateOps = sb.ops.filter((op) => op.table.startsWith('affiliate'))
  assert.ok(affiliateOps.length > 0)
  assert.ok(affiliateOps.every((op) => op.op === 'select'))
  assert.equal(sb.ops.some((op) => op.op === 'update' || op.op === 'delete'), false)
})

test('a model failure stores nothing and an unconfigured agent does not invent a marketing draft', async () => {
  const failed = memoryDb()
  const broken = await call(scheduleHandler, {
    method: 'POST',
    url: '/api/agents?kind=outreach',
    headers: { authorization: `Bearer ${SECRET}` },
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key' },
    sb: failed,
    draftFetch: async () => ({ ok: false, status: 502, async json() { return {} } }),
  })
  assert.equal(broken.status, 500)
  assert.equal(failed.tables.agent_drafts.length, 0)

  const quiet = memoryDb()
  const unconfigured = await call(scheduleHandler, {
    method: 'POST',
    url: '/api/agents?kind=marketing',
    headers: { authorization: `Bearer ${SECRET}` },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET }, sb: quiet })
  assert.equal(unconfigured.status, 200)
  assert.equal(unconfigured.json.send, false)
  assert.equal(unconfigured.json.reason, 'unconfigured')
  assert.deepEqual(unconfigured.json.drafts, [])
  assert.equal(quiet.tables.agent_drafts.length, 0)
})

test('press mail stores a reply draft and a marketing agent draft, and a retry does not duplicate it', async () => {
  const sb = memoryDb()
  const ai = model((system) => (
    system.includes('campaign idea')
      ? 'Story idea for the campus paper.'
      : 'Thanks for the note. John will follow up.'
  ))
  const env = { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key', OPENAI_API_KEY: 'sk-ignored' }
  const body = {
    message: {
      messageId: '<press-1@mail>',
      from: 'editor@paper.test',
      to: 'press@clemsonrides.com',
      subject: 'Campus feature',
      text: 'Can you share a comment?',
    },
  }
  const deps = { env, sb, draftFetch: ai.draftFetch, fetch: async () => ({ ok: true, status: 200 }) }
  const first = await call(handler, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body }, deps)
  assert.equal(first.status, 200)
  assert.equal(sb.tables.inbound_agent_mail[0].status, 'draft_ready')
  assert.match(sb.tables.inbound_agent_mail[0].draft_reply, /John will follow up/)
  assert.equal(sb.tables.agent_drafts.length, 1)
  assert.equal(sb.tables.agent_drafts[0].kind, 'marketing')
  assert.equal(sb.tables.agent_drafts[0].source, 'mail')
  assert.match(sb.tables.agent_drafts[0].body, /Story idea/)
  assert.match(sb.tables.agent_drafts[0].body, /101 North Main Street, Greenville, SC 29601/)
  const second = await call(handler, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body }, deps)
  assert.equal(second.status, 200)
  assert.equal(sb.tables.agent_drafts.length, 1)
})

test('noreply is still skipped and marketing-tagged support mail drafts marketing without sending', async () => {
  const sb = memoryDb()
  const skipped = await call(handler, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { message: { messageId: '<skip>', to: 'noreply@clemsonrides.com', subject: 'Affiliate onboarding', tags: ['marketing'] } },
  }, { env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key' }, sb, draftFetch: async () => { throw new Error('should not draft') } })
  assert.equal(skipped.status, 200)
  assert.equal(skipped.json.skipped, true)
  assert.equal(sb.tables.agent_drafts.length, 0)
  assert.equal(sb.tables.inbound_agent_mail.length, 0)

  const ai = model((system) => (
    system.includes('campaign idea') ? 'A tagged campaign note.' : 'We can help with that hold.'
  ))
  const tagged = await call(handler, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: {
      message: {
        messageId: '<support-m>',
        to: 'support@clemsonrides.com',
        subject: 'Question',
        text: 'Hello',
      },
      tags: ['marketing'],
    },
  }, {
    env: { HOSTINGER_MAIL_WEBHOOK_SECRET: SECRET, NVIDIA_API_KEY: 'nvapi-test-key' },
    sb,
    draftFetch: ai.draftFetch,
  })
  assert.equal(tagged.status, 200)
  assert.equal(sb.tables.agent_drafts.length, 1)
  assert.equal(sb.tables.agent_drafts[0].kind, 'marketing')
  assert.equal(sb.tables.inbound_agent_mail[0].mailbox, 'support@clemsonrides.com')
})

test('agent source has no send path and affiliate reads stay selects', () => {
  const files = [
    './agentDrafts.js',
    './affiliateAgentRead.js',
    './webhookSecret.js',
    '../api/agents.js',
    '../shared/copy/agentDrafts.js',
    '../shared/adminInbox.js',
    '../src/components/AdminInboxPanel.jsx',
  ]
  const source = files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')
  assert.equal(/resend|nodemailer|smtp|sendMail|api\.resend\.com|OPENAI_API_KEY|api\.openai\.com/i.test(source), false)
  assert.equal(/createTransport|graph\.facebook|api\.twitter|instagram|hootsuite/i.test(source), false)
  assert.match(source, /does not send email/i)
  assert.match(source, /Do not post to social networks/)
  const reader = readFileSync(new URL('./affiliateAgentRead.js', import.meta.url), 'utf8')
  assert.equal(/\.(insert|update|delete|upsert)\s*\(/.test(reader), false)
  assert.equal(/stripe|transferApproved|createExpressAccount/i.test(reader), false)
  const agents = readFileSync(new URL('./agentDrafts.js', import.meta.url), 'utf8')
  assert.equal(/from\('affiliate/.test(agents), false)
  assert.match(agents, /readAffiliateSnapshot/)
  assert.match(agents, /send: false/)
})
