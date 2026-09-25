import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('STRIPE_') || key.startsWith('SUPABASE_') || key.startsWith('GOOGLE_')) {
    delete process.env[key]
  }
}

// Loader hook must be registered before supportTicket.js imports its service clients.
register(new URL('../tests/fixtures/admin-support/supportTicketHook.js', import.meta.url), import.meta.url)

const { default: handler } = await import('./endpoints/supportTicket.js')
const supabase = await import('../tests/fixtures/admin-support/supportTicketSupabaseAdmin.js')
const http = await import('../tests/fixtures/admin-support/supportTicketAgentHttp.js')
const staff = await import('../tests/fixtures/admin-support/supportTicketStaffAccess.js')
const users = await import('../tests/fixtures/admin-support/supportTicketUserContext.js')
const bot = await import('../tests/fixtures/admin-support/supportTicketApplySupportBot.js')
const { createFakeSb, hasFilter } = await import('../tests/fixtures/admin-support/adminDeskSb.js')

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TICKET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_TICKET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const USER = { id: USER_ID, email: 'ada@clemson.edu' }
const OTHER_USER = { id: OTHER_ID, email: 'bo@clemson.edu' }
const SUBJECT = 'Map crashes on open'
const BODY = 'The rider map crashes when the screen opens.'
const MISSING_GET = 'Support tickets are not in the database yet. Apply supabase/migrations/20260923120000_support_tickets.sql and supabase/migrations/20260924190000_admin_support.sql.'
const MISSING_POST = 'Support tickets are not in the database yet. Apply supabase/migrations/20260923120000_support_tickets.sql and supabase/migrations/20260924190000_admin_support.sql, or email rides@clemson.edu.'
const LIST_COLUMNS = 'id, user_id, role_variant, category, subject, body, status, bot_intent, escalation_reason, created_at'
const FALLBACK_COLUMNS = 'id, user_id, role_variant, category, subject, body, status, created_at'

const CONTEXT = {
  signedIn: true,
  role: 'rider',
  name: 'Ada',
  email: 'ada@clemson.edu',
  billing: { hasCard: true },
  student: { verified: false },
  recentTrips: [{ status: 'completed' }],
}

const METADATA = {
  source: 'support-agent',
  role: 'rider',
  hasCard: true,
  studentVerified: false,
  latestTripStatus: 'completed',
}

let networkHits = 0
const originalFetch = globalThis.fetch

test.before(() => {
  globalThis.fetch = async () => {
    networkHits += 1
    throw new Error('support ticket test attempted a network fetch')
  }
})

test.after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkHits, 0)
})

test.beforeEach(() => {
  supabase.state.client = createFakeSb()
  supabase.state.user = { ...USER }
  supabase.state.authCalls = 0
  staff.state.access = { admin: false, support: false, profile: null }
  staff.state.calls = []
  users.state.context = {
    ...CONTEXT,
    billing: { ...CONTEXT.billing },
    student: { ...CONTEXT.student },
    recentTrips: CONTEXT.recentTrips.map((trip) => ({ ...trip })),
  }
  users.state.calls = []
  users.state.throwOnLoad = false
  bot.state.calls = []
  bot.state.result = null
  http.rateLimitCalls.length = 0
  http.resetRateLimits()
})

function calls(table, op) {
  return supabase.state.client.calls.filter((ctx) => ctx.table === table && (op == null || ctx.op === op))
}

function validBody(extra = {}) {
  return {
    confirmed: true,
    category: 'bug',
    subject: SUBJECT,
    body: BODY,
    roleVariant: 'rider',
    ...extra,
  }
}

function succeedInserts(sb) {
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'insert' && ctx.terminal === 'single', (ctx) => ({
    data: {
      id: TICKET_ID,
      status: ctx.payload.status,
      category: ctx.payload.category,
      subject: ctx.payload.subject,
      body: ctx.payload.body,
      metadata: ctx.payload.metadata,
      role_variant: ctx.payload.role_variant,
      created_at: '2026-09-25T12:00:00.000Z',
    },
    error: null,
  }))
}

async function invoke({ method = 'GET', url = '/api/support-ticket', body, user, access, client, context } = {}) {
  if (client !== undefined) supabase.state.client = client
  if (user !== undefined) supabase.state.user = user
  if (access !== undefined) staff.state.access = access
  if (context !== undefined) users.state.context = context
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
  await handler({ method, url, headers: {}, body }, res)
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    res,
  }
}

test('OPTIONS preflight is handled by real cors and stops before auth', async () => {
  supabase.state.client = null
  supabase.state.user = null
  const res = await invoke({ method: 'OPTIONS' })
  assert.equal(res.status, 204)
  assert.deepEqual(res.json, {})
  assert.equal(res.res.headers['Access-Control-Allow-Origin'], '*')
  assert.equal(supabase.state.authCalls, 0)
  assert.equal(staff.state.calls.length, 0)
})

test('PUT and DELETE are 405 before a service client is required', async () => {
  supabase.state.client = null
  supabase.state.user = null
  for (const method of ['PUT', 'DELETE']) {
    const res = await invoke({ method })
    assert.equal(res.status, 405, method)
    assert.equal(res.json.error, 'Method not allowed')
    assert.equal(res.res.headers['Content-Type'], 'application/json')
  }
  assert.equal(supabase.state.authCalls, 0)
  assert.equal(http.rateLimitCalls.length, 0)
})

test('missing service client is 503 on GET and POST', async () => {
  supabase.state.client = null
  for (const method of ['GET', 'POST']) {
    const res = await invoke({ method, body: validBody(), client: null })
    assert.equal(res.status, 503, method)
    assert.equal(res.json.error, 'SUPABASE_SERVICE_ROLE_KEY is not configured.')
  }
  assert.equal(supabase.state.authCalls, 0)
  assert.equal(staff.state.calls.length, 0)
  assert.equal(http.rateLimitCalls.length, 0)
})

test('missing user is 401 on GET and POST', async () => {
  for (const method of ['GET', 'POST']) {
    supabase.state.authCalls = 0
    staff.state.calls = []
    const res = await invoke({ method, body: validBody(), user: null })
    assert.equal(res.status, 401, method)
    assert.equal(res.json.error, 'Sign in required')
    assert.equal(supabase.state.authCalls, 1, method)
    assert.equal(staff.state.calls.length, 0, method)
    assert.equal(supabase.state.client.calls.length, 0, method)
  }
  assert.equal(http.rateLimitCalls.length, 0)
})

test('GET for a non-staff caller filters support_tickets by user_id', async () => {
  const sb = createFakeSb()
  const own = {
    id: TICKET_ID,
    user_id: USER_ID,
    role_variant: 'rider',
    category: 'bug',
    subject: 'Map crash today',
    body: 'The map crashes on open today',
    status: 'open',
    created_at: '2026-09-25T00:00:00.000Z',
  }
  const other = { ...own, id: OTHER_TICKET_ID, user_id: OTHER_ID, subject: 'Other person issue', body: 'Another rider wrote this note' }
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'list', (ctx) => {
    const filter = ctx.filters.find((entry) => entry.op === 'eq' && entry.column === 'user_id')
    const rows = filter ? [own, other].filter((row) => row.user_id === filter.value) : [own, other]
    return { data: rows, error: null }
  })
  const res = await invoke({ client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.isAdmin, false)
  assert.equal(res.json.isStaff, false)
  assert.deepEqual(res.json.tickets.map((ticket) => ticket.id), [TICKET_ID])
  const query = calls('support_tickets')[0]
  assert.equal(query.columns, LIST_COLUMNS)
  assert.deepEqual(query.orderBy, { column: 'created_at', ascending: false })
  assert.equal(query.limitN, 30)
  assert.equal(query.filters.length, 1)
  assert.equal(hasFilter(query, 'eq', 'user_id', USER_ID), true)
  assert.equal(staff.state.calls.length, 1)
  assert.equal(staff.state.calls[0].user.id, USER_ID)
  assert.equal(http.rateLimitCalls.length, 0)
})

test('GET for support staff and admins is unfiltered', async () => {
  const rows = [
    { id: TICKET_ID, user_id: USER_ID, subject: 'Map crash today', body: 'The map crashes on open today', status: 'open' },
    { id: OTHER_TICKET_ID, user_id: OTHER_ID, subject: 'Other person issue', body: 'Another rider wrote this note', status: 'escalated' },
  ]
  for (const access of [
    { admin: false, support: true, profile: null },
    { admin: true, support: true, profile: { id: USER_ID, role: 'admin' } },
  ]) {
    const sb = createFakeSb()
    sb.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'list', () => ({ data: rows, error: null }))
    const res = await invoke({ client: sb, access })
    assert.equal(res.status, 200)
    assert.equal(res.json.isAdmin, access.admin)
    assert.equal(res.json.isStaff, true)
    assert.deepEqual(res.json.tickets.map((ticket) => ticket.id), [TICKET_ID, OTHER_TICKET_ID])
    const query = sb.calls.find((ctx) => ctx.table === 'support_tickets')
    assert.equal(query.filters.length, 0)
    assert.equal(query.limitN, 30)
  }
})

test('GET redacts peer surnames using the loaded viewer context', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets', () => ({
    data: [{
      id: TICKET_ID,
      user_id: USER_ID,
      subject: 'Sam Rivera was late',
      body: 'Sam Rivera never arrived at the pickup spot',
      status: 'open',
    }],
    error: null,
  }))
  const res = await invoke({
    client: sb,
    context: { ...CONTEXT, _peerFullNames: ['Sam Rivera'] },
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.tickets[0].subject, 'Sam was late')
  assert.equal(res.json.tickets[0].body, 'Sam never arrived at the pickup spot')
  assert.equal(res.json.tickets[0].status, 'open')
})

test('GET still lists tickets when loadUserContext throws', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets', () => ({
    data: [{ id: TICKET_ID, user_id: USER_ID, subject: 'Sam Rivera was late', body: 'Sam Rivera never arrived today', status: 'open' }],
    error: null,
  }))
  users.state.throwOnLoad = true
  const res = await invoke({ client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.tickets[0].subject, 'Sam Rivera was late')
  assert.equal(users.state.calls.length, 1)
})

test('GET missing support_tickets table is 503 with the migration message', async () => {
  for (const message of [
    'relation "support_tickets" does not exist',
    'Could not find the table public.support_tickets in the schema cache',
  ]) {
    const sb = createFakeSb()
    sb.when((ctx) => ctx.table === 'support_tickets', () => ({ data: null, error: { message } }))
    users.state.calls = []
    const res = await invoke({ client: sb })
    assert.equal(res.status, 503, message)
    assert.equal(res.json.error, MISSING_GET)
    assert.deepEqual(res.json.tickets, [])
    assert.equal(sb.calls.filter((ctx) => ctx.table === 'support_tickets').length, 1)
    assert.equal(users.state.calls.length, 0)
    assert.equal(bot.state.calls.length, 0)
  }
})

test('GET retries a reduced column list when Postgres or PostgREST reports a missing column', async () => {
  const messages = [
    'column support_tickets.bot_intent does not exist',
    'column "bot_intent" of relation "support_tickets" does not exist',
    "Could not find the 'bot_intent' column of 'support_tickets' in the schema cache",
  ]
  for (const message of messages) {
    for (const support of [false, true]) {
      const sb = createFakeSb()
      let tries = 0
      sb.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'list', () => {
        tries += 1
        if (tries === 1) return { data: null, error: { message } }
        return {
          data: [{
            id: TICKET_ID,
            user_id: USER_ID,
            subject: 'Sam Rivera was late',
            body: 'Sam Rivera never arrived at the pickup spot',
            status: 'open',
          }],
          error: null,
        }
      })
      const res = await invoke({
        client: sb,
        access: { admin: support, support, profile: null },
        context: { ...CONTEXT, _peerFullNames: ['Sam Rivera'] },
      })
      assert.equal(res.status, 200, `${message} support=${support}`)
      assert.equal(res.json.tickets.length, 1)
      assert.equal(res.json.tickets[0].subject, 'Sam was late', message)
      assert.equal(res.json.tickets[0].body, 'Sam never arrived at the pickup spot', message)
      assert.equal(res.json.isStaff, support)
      assert.equal(res.json.isAdmin, support)
      const queries = sb.calls.filter((ctx) => ctx.table === 'support_tickets')
      assert.equal(queries.length, 2, `${message} support=${support}`)
      assert.equal(queries[0].columns, LIST_COLUMNS)
      assert.equal(queries[1].columns, FALLBACK_COLUMNS)
      assert.equal(hasFilter(queries[0], 'eq', 'user_id', USER_ID), !support)
      assert.equal(hasFilter(queries[1], 'eq', 'user_id', USER_ID), !support)
      assert.equal(queries[1].limitN, 30)
    }
  }
})

test('GET missing-column retry that still fails is 500, not a missing-table 503', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets', () => ({
    data: null,
    error: { message: 'column "escalation_reason" of relation "support_tickets" does not exist' },
  }))
  const res = await invoke({ client: sb })
  assert.equal(res.status, 500)
  assert.equal(res.json.error, 'Could not load tickets.')
  assert.equal(res.json.tickets, undefined)
  assert.equal(sb.calls.filter((ctx) => ctx.table === 'support_tickets').length, 2)
  assert.equal(users.state.calls.length, 0)
})

test('GET retries a reduced column list when the error names a column only', async () => {
  for (const support of [false, true]) {
    const sb = createFakeSb()
    let tries = 0
    sb.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'list', () => {
      tries += 1
      if (tries === 1) return { data: null, error: { message: 'column bot_intent unavailable' } }
      return {
        data: [{ id: TICKET_ID, user_id: USER_ID, subject: 'Map crash today', body: 'The map crashes on open today', status: 'open' }],
        error: null,
      }
    })
    const res = await invoke({
      client: sb,
      access: { admin: support, support, profile: null },
    })
    assert.equal(res.status, 200, `support=${support}`)
    assert.equal(res.json.tickets.length, 1)
    assert.equal(res.json.isStaff, support)
    const queries = sb.calls.filter((ctx) => ctx.table === 'support_tickets')
    assert.equal(queries.length, 2, `support=${support}`)
    assert.equal(hasFilter(queries[0], 'eq', 'user_id', USER_ID), !support)
    assert.equal(hasFilter(queries[1], 'eq', 'user_id', USER_ID), !support)
    assert.equal(queries[0].columns, LIST_COLUMNS)
    assert.equal(queries[1].columns, FALLBACK_COLUMNS)
    assert.equal(queries[1].limitN, 30)
  }
})

test('GET retry failure and other list errors are 500', async () => {
  const columnThenBroken = createFakeSb()
  let tries = 0
  columnThenBroken.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'list', () => {
    tries += 1
    if (tries === 1) return { data: null, error: { message: 'column bot_intent unavailable' } }
    return { data: null, error: { message: 'still broken' } }
  })
  const retry = await invoke({ client: columnThenBroken })
  assert.equal(retry.status, 500)
  assert.equal(retry.json.error, 'Could not load tickets.')
  assert.equal(columnThenBroken.calls.length, 2)

  const generic = createFakeSb()
  generic.when((ctx) => ctx.table === 'support_tickets', () => ({ data: null, error: { message: 'timeout acquiring connection' } }))
  const res = await invoke({ client: generic })
  assert.equal(res.status, 500)
  assert.equal(res.json.error, 'Could not load tickets.')
  assert.equal(generic.calls.length, 1)
})

test('POST validateTicket failures are 400 and do not write', async () => {
  const cases = [
    [{ ...validBody(), confirmed: false }, 'Confirm the ticket in Support before it is filed.'],
    [{ ...validBody(), confirmed: 'true' }, 'Confirm the ticket in Support before it is filed.'],
    [{ ...validBody(), category: 'refund' }, 'Category must be bug, billing, ride dispute, account, safety, or other.'],
    [{ ...validBody(), subject: 'ab' }, 'Subject should be 4–140 characters.'],
    [{ ...validBody(), subject: `  ${'a'.repeat(141)}` }, 'Subject should be 4–140 characters.'],
    [{ ...validBody(), body: 'short' }, 'Add a short description before filing.'],
    [{ ...validBody(), body: 'a'.repeat(4001) }, 'Add a short description before filing.'],
  ]
  for (const [body, error] of cases) {
    http.resetRateLimits()
    bot.state.calls = []
    const sb = createFakeSb()
    const res = await invoke({ method: 'POST', body, client: sb })
    assert.equal(res.status, 400, error)
    assert.equal(res.json.error, error)
    assert.equal(sb.calls.length, 0)
    assert.equal(bot.state.calls.length, 0)
  }
})

test('POST invalid JSON is 400', async () => {
  const res = await invoke({ method: 'POST', body: '{' })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'Invalid JSON')
  assert.equal(calls('support_tickets').length, 0)
  assert.equal(bot.state.calls.length, 0)
})

test('POST body over 40000 characters is 400', async () => {
  const res = await invoke({ method: 'POST', body: `{${'a'.repeat(40_000)}` })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'Message is too large')
  assert.equal(calls('support_tickets').length, 0)
})

test('sixth ticket POST in the window is 429 and a different user is not', async () => {
  const sb = createFakeSb()
  succeedInserts(sb)
  for (let i = 0; i < 5; i += 1) {
    const res = await invoke({ method: 'POST', body: { confirmed: false }, client: sb })
    assert.equal(res.status, 400, `attempt ${i}`)
  }
  const blocked = await invoke({ method: 'POST', body: validBody(), client: sb })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.json.error, 'Too many tickets. Wait a few minutes or email rides@clemson.edu.')
  assert.equal(calls('support_tickets', 'insert').length, 0)
  assert.equal(bot.state.calls.length, 0)
  assert.deepEqual(http.rateLimitCalls[0], {
    bucket: 'ticket',
    userId: USER_ID,
    limit: 5,
    windowMs: 10 * 60_000,
  })
  assert.equal(http.rateLimitCalls.length, 6)

  const allowed = await invoke({ method: 'POST', body: validBody(), client: sb, user: { ...OTHER_USER } })
  assert.equal(allowed.status, 200)
  assert.equal(calls('support_tickets', 'insert').length, 1)
  assert.equal(calls('support_tickets', 'insert')[0].payload.user_id, OTHER_ID)
  assert.equal(bot.state.calls.length, 1)
})

test('POST files a confirmed ticket and returns the stub bot decision', async () => {
  const sb = createFakeSb()
  succeedInserts(sb)
  bot.state.result = {
    decision: {
      reply: 'Logged for the desk.',
      intent: 'bug_report',
      confidence: 0.91,
      status: 'waiting_user',
      escalate: false,
      reason: 'need_screenshot',
    },
    ticket: { id: TICKET_ID, status: 'waiting_user', bot_intent: 'bug_report' },
  }
  const res = await invoke({ method: 'POST', body: validBody({ roleVariant: 'driver' }), client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.bot, {
    reply: 'Logged for the desk.',
    intent: 'bug_report',
    confidence: 0.91,
    status: 'waiting_user',
    escalated: false,
    reason: 'need_screenshot',
  })
  assert.equal(res.json.ticket.id, TICKET_ID)
  assert.equal(res.json.ticket.status, 'waiting_user')
  assert.equal(res.json.ticket.bot_intent, 'bug_report')
  assert.equal(res.json.ticket.subject, SUBJECT)
  const insert = calls('support_tickets', 'insert')[0]
  assert.equal(insert.terminal, 'single')
  assert.equal(insert.columns, 'id, status, category, subject, body, metadata, role_variant, created_at')
  assert.deepEqual(insert.payload, {
    user_id: USER_ID,
    role_variant: 'rider',
    category: 'bug',
    subject: SUBJECT,
    body: BODY,
    metadata: METADATA,
    status: 'bot_handling',
  })
  assert.equal(bot.state.calls.length, 1)
  assert.equal(bot.state.calls[0].sb, sb)
  assert.equal(bot.state.calls[0].input.text, `${SUBJECT}\n${BODY}`)
  assert.equal(bot.state.calls[0].input.roleVariant, 'rider')
  assert.equal(bot.state.calls[0].input.ticket.id, TICKET_ID)
  assert.equal(bot.state.calls[0].input.context, users.state.context)
  assert.equal(calls('support_ticket_messages').length, 0)
  assert.equal(calls('admin_notifications').length, 0)
  assert.deepEqual(http.rateLimitCalls[0], {
    bucket: 'ticket',
    userId: USER_ID,
    limit: 5,
    windowMs: 10 * 60_000,
  })
})

test('POST stores the role variant resolveRoleVariant allows', async () => {
  const cases = [
    [{ role: 'rider' }, 'driver', 'rider'],
    [{ role: 'driver' }, 'rider', 'driver'],
    [{ role: 'both' }, 'driver', 'driver'],
    [{ role: 'both' }, 'rider', 'rider'],
  ]
  for (const [rolePatch, requested, expected] of cases) {
    http.resetRateLimits()
    bot.state.calls = []
    const sb = createFakeSb()
    succeedInserts(sb)
    const res = await invoke({
      method: 'POST',
      body: validBody({ roleVariant: requested }),
      client: sb,
      context: { ...CONTEXT, ...rolePatch, billing: { ...CONTEXT.billing }, recentTrips: [{ status: 'completed' }] },
    })
    assert.equal(res.status, 200, `${rolePatch.role}->${requested}`)
    assert.equal(calls('support_tickets', 'insert')[0].payload.role_variant, expected)
    assert.equal(bot.state.calls[0].input.roleVariant, expected)
  }
})

test('POST redacts peer surnames before validate and insert', async () => {
  const sb = createFakeSb()
  succeedInserts(sb)
  const res = await invoke({
    method: 'POST',
    body: validBody({
      subject: 'Sam Rivera was late',
      body: 'Sam Rivera never arrived at the pickup spot',
    }),
    client: sb,
    context: { ...CONTEXT, _peerFullNames: ['Sam Rivera'], billing: { hasCard: false }, student: { verified: true }, recentTrips: [] },
  })
  assert.equal(res.status, 200)
  const payload = calls('support_tickets', 'insert')[0].payload
  assert.equal(payload.subject, 'Sam was late')
  assert.equal(payload.body, 'Sam never arrived at the pickup spot')
  assert.deepEqual(payload.metadata, {
    source: 'support-agent',
    role: 'rider',
    hasCard: false,
    studentVerified: true,
    latestTripStatus: null,
  })
  assert.equal(bot.state.calls[0].input.text, 'Sam was late\nSam never arrived at the pickup spot')
  assert.equal(res.json.ticket.subject, 'Sam was late')
})

test('POST still files when loadUserContext throws', async () => {
  const sb = createFakeSb()
  succeedInserts(sb)
  users.state.throwOnLoad = true
  const res = await invoke({ method: 'POST', body: validBody(), client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(calls('support_tickets', 'insert')[0].payload.metadata, {
    source: 'support-agent',
    role: 'rider',
    hasCard: false,
    studentVerified: false,
    latestTripStatus: null,
  })
  assert.equal(calls('support_tickets', 'insert')[0].payload.role_variant, 'rider')
})

test('POST retries insert with status open when the check constraint rejects bot_handling', async () => {
  const sb = createFakeSb()
  let tries = 0
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'insert', () => {
    tries += 1
    if (tries === 1) {
      return { data: null, error: { message: 'new row violates check constraint "support_tickets_status_check"' } }
    }
    return {
      data: {
        id: TICKET_ID,
        status: 'open',
        category: 'bug',
        subject: SUBJECT,
        body: BODY,
        metadata: METADATA,
        role_variant: 'rider',
        created_at: '2026-09-25T12:00:00.000Z',
      },
      error: null,
    }
  })
  const res = await invoke({ method: 'POST', body: validBody(), client: sb })
  assert.equal(res.status, 200)
  const inserts = calls('support_tickets', 'insert')
  assert.equal(inserts.length, 2)
  assert.equal(inserts[0].payload.status, 'bot_handling')
  assert.equal(inserts[1].payload.status, 'open')
  assert.equal(bot.state.calls.length, 1)
  assert.equal(res.json.ticket.status, 'bot_handling')
})

test('POST insert errors map to 503, 409, and 500', async () => {
  const cases = [
    ['relation "support_tickets" does not exist', 503, MISSING_POST],
    ['violates foreign key constraint', 409, 'Open Account once so your profile exists, then file the ticket again.'],
    ['timeout acquiring connection', 500, 'Could not file the ticket.'],
  ]
  for (const [message, status, error] of cases) {
    http.resetRateLimits()
    bot.state.calls = []
    const sb = createFakeSb()
    sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'insert', () => ({ data: null, error: { message } }))
    const res = await invoke({ method: 'POST', body: validBody(), client: sb })
    assert.equal(res.status, status, message)
    assert.equal(res.json.error, error)
    assert.equal(sb.calls.filter((ctx) => ctx.op === 'insert').length, 1, message)
    assert.equal(bot.state.calls.length, 0, message)
  }
})

test('POST permission errors that name support_tickets are reported as a missing table', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'insert', () => ({
    data: null,
    error: { message: 'permission denied for table support_tickets' },
  }))
  const res = await invoke({ method: 'POST', body: validBody(), client: sb })
  // The missing-table regex matches any message that names support_tickets,
  // so a permission failure is returned as the migration 503.
  assert.equal(res.status, 503)
  assert.equal(res.json.error, MISSING_POST)
  assert.equal(calls('support_tickets', 'insert').length, 1)
  assert.equal(bot.state.calls.length, 0)
})

test('reply without a ticket id is 400 and does not read the table', async () => {
  for (const body of [
    { op: 'reply', body: 'Following up on the map crash' },
    { op: 'reply', ticketId: '   ', body: 'Following up on the map crash' },
    { op: 'reply', ticket_id: '', body: 'Following up on the map crash' },
  ]) {
    http.resetRateLimits()
    const sb = createFakeSb()
    const res = await invoke({ method: 'POST', body, client: sb })
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'ticketId is required')
    assert.equal(sb.calls.length, 0)
    assert.equal(bot.state.calls.length, 0)
  }
})

test('reply with an empty or oversized body is 400', async () => {
  for (const text of ['', '   ', 'a'.repeat(4001)]) {
    http.resetRateLimits()
    const sb = createFakeSb()
    const res = await invoke({ method: 'POST', body: { op: 'reply', ticketId: TICKET_ID, body: text }, client: sb })
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'Reply must be 1–4000 characters')
    assert.equal(sb.calls.length, 0)
  }
})

test('reply to a missing or other-user ticket is 404', async () => {
  const missing = createFakeSb()
  const missingRes = await invoke({
    method: 'POST',
    body: { op: 'reply', ticketId: TICKET_ID, body: 'Following up on the map crash' },
    client: missing,
  })
  assert.equal(missingRes.status, 404)
  assert.equal(missingRes.json.error, 'Ticket not found')
  assert.equal(missing.calls.filter((ctx) => ctx.table === 'support_ticket_messages').length, 0)
  assert.equal(bot.state.calls.length, 0)

  http.resetRateLimits()
  bot.state.calls = []
  const other = createFakeSb()
  other.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'maybeSingle', () => ({
    data: {
      id: TICKET_ID,
      user_id: OTHER_ID,
      status: 'open',
      category: 'bug',
      subject: SUBJECT,
      body: BODY,
      role_variant: 'rider',
    },
    error: null,
  }))
  const otherRes = await invoke({
    method: 'POST',
    body: { op: 'reply', ticketId: TICKET_ID, body: 'Following up on the map crash' },
    client: other,
  })
  assert.equal(otherRes.status, 404)
  assert.equal(otherRes.json.error, 'Ticket not found')
  assert.equal(hasFilter(other.calls[0], 'eq', 'id', TICKET_ID), true)
  assert.equal(other.calls.filter((ctx) => ctx.table === 'support_ticket_messages').length, 0)
  assert.equal(bot.state.calls.length, 0)
})

test('reply on the caller ticket stores the message and runs the stub bot', async () => {
  const sb = createFakeSb()
  const existing = {
    id: TICKET_ID,
    user_id: USER_ID,
    status: 'bot_handling',
    category: 'bug',
    subject: SUBJECT,
    body: BODY,
    metadata: METADATA,
    role_variant: 'driver',
  }
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'maybeSingle', () => ({ data: existing, error: null }))
  bot.state.result = {
    decision: {
      reply: 'Stub follow-up.',
      intent: 'bug_report',
      confidence: 0.7,
      status: 'waiting_user',
      escalate: false,
      reason: null,
    },
    ticket: { id: TICKET_ID, status: 'waiting_user' },
  }
  const res = await invoke({
    method: 'POST',
    body: { op: 'reply', ticket_id: TICKET_ID, body: '  Sam Rivera never arrived at pickup  ' },
    client: sb,
    context: { ...CONTEXT, _peerFullNames: ['Sam Rivera'] },
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ticket.status, 'waiting_user')
  assert.equal(res.json.bot.reply, 'Stub follow-up.')
  assert.equal(res.json.bot.escalated, false)
  const message = calls('support_ticket_messages', 'insert')[0]
  assert.deepEqual(message.payload, {
    ticket_id: TICKET_ID,
    author_id: USER_ID,
    author_role: 'user',
    body: 'Sam never arrived at pickup',
  })
  assert.equal(bot.state.calls.length, 1)
  assert.equal(bot.state.calls[0].input.text, 'Sam never arrived at pickup')
  assert.equal(bot.state.calls[0].input.roleVariant, 'driver')
  assert.equal(bot.state.calls[0].input.ticket, existing)
  assert.equal(calls('admin_notifications').length, 0)
})

test('reply on an escalated ticket notifies admins and does not run the bot', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'maybeSingle', () => ({
    data: {
      id: TICKET_ID,
      user_id: USER_ID,
      status: 'escalated',
      category: 'safety',
      subject: SUBJECT,
      body: BODY,
      role_variant: 'rider',
    },
    error: null,
  }))
  const res = await invoke({
    method: 'POST',
    body: { op: 'reply', ticketId: TICKET_ID, body: 'Still waiting on a person' },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, {
    ticket: { id: TICKET_ID, status: 'escalated' },
    bot: {
      reply: 'An admin already has this ticket. Your reply was added for them.',
      status: 'escalated',
      escalated: true,
      reason: 'already_escalated',
    },
  })
  assert.equal(bot.state.calls.length, 0)
  assert.deepEqual(calls('admin_notifications', 'insert')[0].payload, {
    kind: 'support_escalation',
    title: 'Escalated ticket updated',
    body: SUBJECT,
    entity_type: 'support_ticket',
    entity_id: TICKET_ID,
  })
})

test('reply load and message-insert errors map to 500 and 503', async () => {
  const load = createFakeSb()
  load.when((ctx) => ctx.table === 'support_tickets', () => ({ data: null, error: { message: 'timeout acquiring connection' } }))
  const loadRes = await invoke({
    method: 'POST',
    body: { op: 'reply', ticketId: TICKET_ID, body: 'Following up on the map crash' },
    client: load,
  })
  assert.equal(loadRes.status, 500)
  assert.equal(loadRes.json.error, 'Could not load that ticket.')

  http.resetRateLimits()
  const missingMessages = createFakeSb()
  missingMessages.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'maybeSingle', () => ({
    data: { id: TICKET_ID, user_id: USER_ID, status: 'open', subject: SUBJECT, role_variant: 'rider' },
    error: null,
  }))
  missingMessages.when((ctx) => ctx.table === 'support_ticket_messages', () => ({
    data: null,
    error: { message: 'relation "support_ticket_messages" does not exist' },
  }))
  const missingRes = await invoke({
    method: 'POST',
    body: { op: 'reply', ticketId: TICKET_ID, body: 'Following up on the map crash' },
    client: missingMessages,
  })
  assert.equal(missingRes.status, 503)
  assert.equal(missingRes.json.error, 'Apply supabase/migrations/20260924190000_admin_support.sql before replying on a ticket.')
  assert.equal(bot.state.calls.length, 0)

  http.resetRateLimits()
  bot.state.calls = []
  const save = createFakeSb()
  save.when((ctx) => ctx.table === 'support_tickets' && ctx.terminal === 'maybeSingle', () => ({
    data: { id: TICKET_ID, user_id: USER_ID, status: 'open', subject: SUBJECT, role_variant: 'rider' },
    error: null,
  }))
  save.when((ctx) => ctx.table === 'support_ticket_messages', () => ({
    data: null,
    error: { message: 'timeout acquiring connection' },
  }))
  const saveRes = await invoke({
    method: 'POST',
    body: { op: 'reply', ticketId: TICKET_ID, body: 'Following up on the map crash' },
    client: save,
  })
  assert.equal(saveRes.status, 500)
  assert.equal(saveRes.json.error, 'Could not save the reply.')
  assert.equal(bot.state.calls.length, 0)
})
