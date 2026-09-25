import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('STRIPE_') || key.startsWith('SUPABASE_') || key.startsWith('GOOGLE_')) {
    delete process.env[key]
  }
}

// Loader hook must be registered before adminDesk.js imports its service clients.
register(new URL('../tests/fixtures/admin-support/adminDeskHook.js', import.meta.url), import.meta.url)

const { default: handler } = await import('./endpoints/adminDesk.js')
const http = await import('../tests/fixtures/admin-support/adminDeskFriendRideLib.js')
const staff = await import('../tests/fixtures/admin-support/adminDeskStaffAccess.js')
const mail = await import('../tests/fixtures/admin-support/adminDeskApplicantMail.js')
const { createFakeSb, hasFilter } = await import('../tests/fixtures/admin-support/adminDeskSb.js')

const GET_ACTIONS = ['overview', 'notifications', 'people', 'trips', 'tickets', 'applicant-thread']
const POST_ACTIONS = ['mark-notification', 'ticket-reply', 'applicant-message', 'info-request']

const ADMIN_USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'john@gmail.com' }
const PROFILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TICKET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOTIFY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const RIDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const DRIVER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const TRIP_ID = '11111111-1111-4111-8111-111111111111'

const MISSING_TABLE = 'Could not find the table public.driver_applications in the schema cache'
const MISSING_RELATION = 'relation "support_tickets" does not exist'

let networkHits = 0
const originalFetch = globalThis.fetch

test.before(() => {
  globalThis.fetch = async () => {
    networkHits += 1
    throw new Error('admin desk test attempted a network fetch')
  }
})

test.after(() => {
  globalThis.fetch = originalFetch
  assert.equal(networkHits, 0)
})

test.beforeEach(() => {
  http.state.client = createFakeSb()
  http.state.user = { ...ADMIN_USER }
  staff.state.access = { admin: true, support: true, profile: { id: ADMIN_USER.id, role: 'admin', is_admin: true } }
  staff.state.calls = []
  mail.state.calls = []
})

function calls(table, op) {
  return http.state.client.calls.filter((ctx) => ctx.table === table && (op == null || ctx.op === op))
}

async function invoke({ method = 'GET', url = '/api/admin?action=overview', body, user, access, client } = {}) {
  if (client !== undefined) http.state.client = client
  if (user !== undefined) http.state.user = user
  if (access !== undefined) staff.state.access = access
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

test('OPTIONS preflight stops before the action check', async () => {
  http.state.client = null
  http.state.user = null
  const res = await invoke({ method: 'OPTIONS', url: '/api/admin?action=overview' })
  assert.equal(res.status, 204)
  assert.deepEqual(res.json, {})
  assert.equal(staff.state.calls.length, 0)
})

test('unknown action is 400 and does not require a service client', async () => {
  http.state.client = null
  http.state.user = null
  const res = await invoke({ url: '/api/admin?action=nope' })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown admin action/)
  assert.match(res.json.error, /info-request/)
  assert.equal(staff.state.calls.length, 0)
})

test('GET-only actions reject POST with 405', async () => {
  http.state.client = null
  for (const action of GET_ACTIONS) {
    const res = await invoke({ method: 'POST', url: `/api/admin?action=${action}`, body: {} })
    assert.equal(res.status, 405, action)
    assert.equal(res.json.error, 'Method not allowed')
  }
  assert.equal(staff.state.calls.length, 0)
})

test('POST-only actions reject GET with 405', async () => {
  http.state.client = null
  for (const action of POST_ACTIONS) {
    const res = await invoke({ method: 'GET', url: `/api/admin?action=${action}` })
    assert.equal(res.status, 405, action)
    assert.equal(res.json.error, 'Method not allowed')
  }
  assert.equal(staff.state.calls.length, 0)
})

test('missing service client is 503 even when a user is present', async () => {
  http.state.client = null
  const res = await invoke({ url: '/api/admin?action=overview' })
  assert.equal(res.status, 503)
  assert.equal(res.json.error, 'SUPABASE_SERVICE_ROLE_KEY not configured')
  assert.equal(staff.state.calls.length, 0)
})

test('missing user is 401', async () => {
  const res = await invoke({ url: '/api/admin?action=overview', user: null })
  assert.equal(res.status, 401)
  assert.equal(res.json.error, 'Sign in required')
  assert.equal(staff.state.calls.length, 0)
  assert.equal(http.state.client.calls.length, 0)
})

test('support-only staff is 403', async () => {
  const res = await invoke({
    url: '/api/admin?action=overview',
    access: { admin: false, support: true, profile: { id: ADMIN_USER.id, role: 'support' } },
  })
  assert.equal(res.status, 403)
  assert.equal(res.json.error, 'Admin only')
  assert.equal(staff.state.calls.length, 1)
  assert.equal(staff.state.calls[0].user.email, ADMIN_USER.email)
  assert.equal(http.state.client.calls.length, 0)
})

test('overview returns safeCount and direct head counts', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'driver_applications', () => ({ count: 2, error: null }))
  sb.when((ctx) => ctx.table === 'admin_notifications', () => ({ count: 3, error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && hasFilter(ctx, 'eq', 'status', 'escalated'), () => ({ count: 1, error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && hasFilter(ctx, 'neq', 'status', 'resolved'), () => ({ count: 4, error: null }))
  const res = await invoke({ url: '/api/admin?action=overview', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, {
    pendingApplications: 2,
    unreadNotifications: 3,
    escalatedTickets: 1,
    activeTickets: 4,
    migrationRequired: false,
    inbox: 'support_tickets',
  })
  const pending = calls('driver_applications')[0]
  assert.equal(pending.head, true)
  assert.equal(pending.countMode, 'exact')
  assert.equal(hasFilter(pending, 'eq', 'onboarding_status', 'pending_review'), true)
  const unread = calls('admin_notifications')[0]
  assert.equal(unread.head, true)
  assert.equal(hasFilter(unread, 'is', 'read_at', null), true)
})

test('overview safeCount missing-table errors zero those counts and flag migration', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'driver_applications', () => ({ count: null, error: { message: MISSING_TABLE } }))
  sb.when((ctx) => ctx.table === 'admin_notifications', () => ({ count: 6, error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && hasFilter(ctx, 'eq', 'status', 'escalated'), () => ({ count: null, error: { message: MISSING_RELATION } }))
  sb.when((ctx) => ctx.table === 'support_tickets' && hasFilter(ctx, 'neq', 'status', 'resolved'), () => ({ count: 8, error: null }))
  const res = await invoke({ url: '/api/admin?action=overview', client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.pendingApplications, 0)
  assert.equal(res.json.escalatedTickets, 0)
  assert.equal(res.json.unreadNotifications, 6)
  assert.equal(res.json.activeTickets, 8)
  assert.equal(res.json.migrationRequired, true)
  assert.equal(res.json.inbox, 'support_tickets')
})

test('overview safeCount non-missing error zeros the count without migrationRequired', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'driver_applications', () => ({ count: null, error: { message: 'permission denied for table driver_applications' } }))
  sb.when((ctx) => ctx.table === 'admin_notifications', () => ({ count: 1, error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && hasFilter(ctx, 'eq', 'status', 'escalated'), () => ({ count: 2, error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && hasFilter(ctx, 'neq', 'status', 'resolved'), () => ({ count: 3, error: null }))
  const res = await invoke({ url: '/api/admin?action=overview', client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.pendingApplications, 0)
  assert.equal(res.json.escalatedTickets, 2)
  assert.equal(res.json.migrationRequired, false)
})

test('notifications returns the latest rows', async () => {
  const sb = createFakeSb()
  const row = {
    id: NOTIFY_ID,
    kind: 'support_escalation',
    title: 'Escalated',
    body: 'Need a person',
    entity_type: 'support_ticket',
    entity_id: TICKET_ID,
    read_at: null,
    created_at: '2026-09-25T00:00:00.000Z',
  }
  sb.when((ctx) => ctx.table === 'admin_notifications', () => ({ data: [row], error: null }))
  const res = await invoke({ url: '/api/admin?action=notifications', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.notifications, [row])
  const query = calls('admin_notifications')[0]
  assert.equal(query.limitN, 50)
  assert.deepEqual(query.orderBy, { column: 'created_at', ascending: false })
})

test('notifications missing table asks for the admin support migration', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'admin_notifications', () => ({ data: null, error: { message: MISSING_TABLE } }))
  const res = await invoke({ url: '/api/admin?action=notifications', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.notifications, [])
  assert.equal(res.json.migrationRequired, true)
  assert.match(res.json.error, /20260924190000_admin_support\.sql/)
})

test('notifications other errors are 500', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'admin_notifications', () => ({ data: null, error: { message: 'timeout' } }))
  const res = await invoke({ url: '/api/admin?action=notifications', client: sb })
  assert.equal(res.status, 500)
  assert.equal(res.json.error, 'timeout')
})

test('people filters by role and returns rows', async () => {
  const sb = createFakeSb()
  const row = { id: PROFILE_ID, full_name: 'Ada', email: 'ada@clemson.edu', phone: null, role: 'driver', is_admin: false }
  sb.when((ctx) => ctx.table === 'profiles', () => ({ data: [row], error: null }))
  const res = await invoke({ url: '/api/admin?action=people&role=driver', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.people, [row])
  const query = calls('profiles')[0]
  assert.equal(hasFilter(query, 'eq', 'role', 'driver'), true)
  assert.equal(query.limitN, 80)
  assert.deepEqual(query.orderBy, { column: 'full_name', ascending: true })
  assert.match(query.columns, /standing/)
})

test('people role=all does not add a role filter', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'profiles', () => ({ data: [], error: null }))
  const res = await invoke({ url: '/api/admin?action=people&role=all', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.people, [])
  assert.equal(calls('profiles')[0].filters.some((filter) => filter.column === 'role'), false)
})

test('people retries without standing columns when the first select fails', async () => {
  const sb = createFakeSb()
  let tries = 0
  sb.when((ctx) => ctx.table === 'profiles', () => {
    tries += 1
    if (tries === 1) return { data: null, error: { message: 'column profiles.standing does not exist' } }
    return { data: [{ id: PROFILE_ID, full_name: 'Ada', email: 'ada@clemson.edu', role: 'rider' }], error: null }
  })
  const res = await invoke({ url: '/api/admin?action=people&role=rider', client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.people[0].full_name, 'Ada')
  assert.equal(calls('profiles').length, 2)
  assert.match(calls('profiles')[0].columns, /standing/)
  assert.doesNotMatch(calls('profiles')[1].columns, /standing/)
  assert.equal(hasFilter(calls('profiles')[1], 'eq', 'role', 'rider'), true)
})

test('trips filters by status and attaches rider and driver names', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'trips', () => ({
    data: [{
      id: TRIP_ID,
      status: 'completed',
      rider_id: RIDER_ID,
      driver_id: DRIVER_ID,
      pickup_label: 'Campus',
      dropoff_label: 'GSP',
      fare_cents: 1200,
      tier: 'standard',
      passengers: 1,
    }],
    error: null,
  }))
  sb.when((ctx) => ctx.table === 'profiles', () => ({
    data: [
      { id: RIDER_ID, full_name: 'Ada', email: 'ada@clemson.edu' },
      { id: DRIVER_ID, full_name: 'Bo', email: 'bo@clemson.edu' },
    ],
    error: null,
  }))
  const res = await invoke({ url: '/api/admin?action=trips&status=completed', client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.trips.length, 1)
  assert.equal(res.json.trips[0].fare_cents, 1200)
  assert.equal(res.json.trips[0].rider.full_name, 'Ada')
  assert.equal(res.json.trips[0].driver.full_name, 'Bo')
  assert.equal(hasFilter(calls('trips')[0], 'eq', 'status', 'completed'), true)
  assert.equal(calls('trips')[0].limitN, 40)
  const profileQuery = calls('profiles')[0]
  assert.equal(profileQuery.filters[0].op, 'in')
  assert.equal(profileQuery.filters[0].column, 'id')
  assert.deepEqual(profileQuery.filters[0].value.slice().sort(), [DRIVER_ID, RIDER_ID].sort())
})

test('tickets list filters by status', async () => {
  const sb = createFakeSb()
  const row = { id: TICKET_ID, user_id: PROFILE_ID, status: 'escalated', subject: 'Charge', category: 'billing' }
  sb.when((ctx) => ctx.table === 'support_tickets', () => ({ data: [row], error: null }))
  const res = await invoke({ url: '/api/admin?action=tickets&status=escalated', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.tickets, [row])
  const query = calls('support_tickets')[0]
  assert.equal(hasFilter(query, 'eq', 'status', 'escalated'), true)
  assert.equal(query.limitN, 50)
  assert.deepEqual(query.orderBy, { column: 'created_at', ascending: false })
})

test('tickets list forwards an unrecognized status filter', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets', () => ({ data: [], error: null }))
  const res = await invoke({ url: '/api/admin?action=tickets&status=not_a_status', client: sb })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.tickets, [])
  assert.equal(hasFilter(calls('support_tickets')[0], 'eq', 'status', 'not_a_status'), true)
})

test('tickets list does not retry a missing column when the error says does not exist', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets', () => ({
    data: null,
    error: { message: 'column support_tickets.bot_intent does not exist' },
  }))
  const res = await invoke({ url: '/api/admin?action=tickets&status=escalated', client: sb })
  // BUG?: tickets() skips its reduced-column retry when the error contains
  // "does not exist" or "schema cache". Those phrases are how Postgres and
  // PostgREST report a missing column, and MISSING treats them as a missing
  // table, so the fallback select never runs.
  assert.equal(res.status, 200)
  assert.equal(res.json.migrationRequired, true)
  assert.deepEqual(res.json.tickets, [])
  assert.equal(calls('support_tickets').length, 1)
})

test('tickets list retries without bot columns when the error names a column only', async () => {
  const sb = createFakeSb()
  let tries = 0
  sb.when((ctx) => ctx.table === 'support_tickets', () => {
    tries += 1
    if (tries === 1) return { data: null, error: { message: 'column bot_intent unavailable' } }
    return { data: [{ id: TICKET_ID, status: 'escalated', subject: 'Fallback' }], error: null }
  })
  const res = await invoke({ url: '/api/admin?action=tickets&status=escalated', client: sb })
  assert.equal(res.status, 200)
  assert.equal(res.json.migrationRequired, undefined)
  assert.equal(res.json.tickets[0].subject, 'Fallback')
  assert.equal(calls('support_tickets').length, 2)
  assert.doesNotMatch(calls('support_tickets')[1].columns, /bot_intent/)
  assert.equal(hasFilter(calls('support_tickets')[1], 'eq', 'status', 'escalated'), true)
})

test('tickets detail rejects a non-uuid id', async () => {
  const res = await invoke({ url: '/api/admin?action=tickets&id=not-a-uuid' })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'Ticket id must be a uuid')
  assert.equal(http.state.client.calls.length, 0)
})

test('applicant-thread rejects a non-uuid profile id', async () => {
  const missing = await invoke({ url: '/api/admin?action=applicant-thread' })
  assert.equal(missing.status, 400)
  assert.equal(missing.json.error, 'profile_id must be a uuid')
  const bad = await invoke({ url: '/api/admin?action=applicant-thread&profile_id=not-a-uuid' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error, 'profile_id must be a uuid')
  assert.equal(http.state.client.calls.length, 0)
})

test('applicant-thread returns messages and info requests', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'driver_application_messages', () => ({
    data: [{ id: 'msg-1', author_role: 'admin', kind: 'message', body: 'Hello', email_stub: null, created_at: '2026-09-25T00:00:00.000Z' }],
    error: null,
  }))
  sb.when((ctx) => ctx.table === 'driver_info_requests', () => ({
    data: [{ id: 'req-1', prompt: 'Need a photo', status: 'open', email_stub: null, emailed_at: null, created_at: '2026-09-25T00:00:00.000Z', fulfilled_at: null }],
    error: null,
  }))
  const res = await invoke({
    url: `/api/admin?action=applicant-thread&profile_id=${PROFILE_ID.toUpperCase()}`,
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.messages[0].body, 'Hello')
  assert.equal(res.json.requests[0].prompt, 'Need a photo')
  assert.equal(hasFilter(calls('driver_application_messages')[0], 'eq', 'profile_id', PROFILE_ID.toUpperCase()), true)
  assert.equal(hasFilter(calls('driver_info_requests')[0], 'eq', 'profile_id', PROFILE_ID.toUpperCase()), true)
})

test('parseBody error is 400', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=mark-notification',
    body: '{',
  })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'Invalid JSON')
  assert.equal(http.state.client.calls.length, 0)
  assert.equal(mail.state.calls.length, 0)
})

test('mark-notification rejects a bad id before writing', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=mark-notification',
    body: { id: 'nope' },
  })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'id must be a uuid')
  assert.equal(calls('admin_notifications', 'update').length, 0)
})

test('mark-notification records a single-row read stamp', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'admin_notifications' && ctx.op === 'update', () => ({ error: null }))
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=mark-notification',
    body: { id: NOTIFY_ID },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  const update = calls('admin_notifications', 'update')[0]
  assert.equal(hasFilter(update, 'eq', 'id', NOTIFY_ID), true)
  assert.match(update.payload.read_at, /^\d{4}-\d{2}-\d{2}T/)
})

test('mark-notification all records an update of unread rows', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.op === 'update', () => ({ error: null }))
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=mark-notification',
    body: { all: true },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  const update = calls('admin_notifications', 'update')[0]
  assert.equal(hasFilter(update, 'is', 'read_at', null), true)
  assert.match(update.payload.read_at, /^\d{4}-\d{2}-\d{2}T/)
})

test('ticket-reply rejects a bad ticket id', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: 'nope', body: 'On it', status: 'waiting_user' },
  })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'ticketId must be a uuid')
  assert.equal(http.state.client.calls.length, 0)
})

test('ticket-reply rejects an empty body', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: TICKET_ID, body: '   ', status: 'waiting_user' },
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Reply must be 1.4000 characters/)
  assert.equal(http.state.client.calls.length, 0)
})

test('ticket-reply rejects an invalid status and bot_handling', async () => {
  const closed = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: TICKET_ID, body: 'On it', status: 'not_a_status' },
  })
  assert.equal(closed.status, 400)
  assert.match(closed.json.error, /status must be open, waiting_user, escalated, or resolved/)
  const bot = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: TICKET_ID, body: 'On it', status: 'bot_handling' },
  })
  assert.equal(bot.status, 400)
  assert.match(bot.json.error, /status must be open, waiting_user, escalated, or resolved/)
  assert.equal(http.state.client.calls.length, 0)
})

test('ticket-reply 404s when the ticket is missing and does not write', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: TICKET_ID, body: 'On it' },
  })
  assert.equal(res.status, 404)
  assert.equal(res.json.error, 'Ticket not found')
  assert.equal(calls('support_ticket_messages', 'insert').length, 0)
  assert.equal(calls('support_tickets', 'update').length, 0)
})

test('ticket-reply records the message and status update', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'select', () => ({ data: { id: TICKET_ID }, error: null }))
  sb.when((ctx) => ctx.table === 'support_ticket_messages' && ctx.op === 'insert', () => ({ error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'update', (ctx) => ({
    data: { id: TICKET_ID, status: ctx.payload.status },
    error: null,
  }))
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: TICKET_ID, body: '  On it  ', status: 'escalated' },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.deepEqual(res.json.ticket, { id: TICKET_ID, status: 'escalated' })
  const insert = calls('support_ticket_messages', 'insert')[0]
  assert.deepEqual(insert.payload, {
    ticket_id: TICKET_ID,
    author_id: ADMIN_USER.id,
    author_role: 'admin',
    body: 'On it',
  })
  const update = calls('support_tickets', 'update')[0]
  assert.deepEqual(update.payload, { status: 'escalated', escalation_reason: 'admin' })
  assert.equal(hasFilter(update, 'eq', 'id', TICKET_ID), true)
  assert.equal(mail.state.calls.length, 0)
})

test('ticket-reply defaults status to waiting_user and clears escalation_reason', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'select', () => ({ data: { id: TICKET_ID }, error: null }))
  sb.when((ctx) => ctx.table === 'support_tickets' && ctx.op === 'update', (ctx) => ({
    data: { id: TICKET_ID, status: ctx.payload.status },
    error: null,
  }))
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticket_id: TICKET_ID, body: 'Noted' },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ticket.status, 'waiting_user')
  assert.deepEqual(calls('support_tickets', 'update')[0].payload, {
    status: 'waiting_user',
    escalation_reason: null,
  })
})

test('applicant-message rejects a bad profile id and an empty body', async () => {
  const badId = await invoke({
    method: 'POST',
    url: '/api/admin?action=applicant-message',
    body: { profileId: 'nope', body: 'Hello' },
  })
  assert.equal(badId.status, 400)
  assert.equal(badId.json.error, 'profileId must be a uuid')
  const empty = await invoke({
    method: 'POST',
    url: '/api/admin?action=applicant-message',
    body: { profileId: PROFILE_ID, body: '  ' },
  })
  assert.equal(empty.status, 400)
  assert.match(empty.json.error, /Message must be 1.4000 characters/)
  assert.equal(http.state.client.calls.length, 0)
  assert.equal(mail.state.calls.length, 0)
  assert.equal(networkHits, 0)
})

test('applicant-message records the note and does not send email', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'profiles', () => ({
    data: { id: PROFILE_ID, email: 'ada@clemson.edu' },
    error: null,
  }))
  sb.when((ctx) => ctx.table === 'driver_application_messages' && ctx.op === 'insert', () => ({
    data: { id: 'msg-1', author_role: 'admin', kind: 'message', body: 'Documents look good', created_at: '2026-09-25T00:00:00.000Z' },
    error: null,
  }))
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=applicant-message',
    body: { profileId: PROFILE_ID, body: ' Documents look good ' },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.emailed, false)
  assert.equal(res.json.email_todo, 'email suppressed in tests')
  assert.equal(res.json.message.body, 'Documents look good')
  const insert = calls('driver_application_messages', 'insert')[0]
  assert.equal(insert.payload.profile_id, PROFILE_ID)
  assert.equal(insert.payload.author_id, ADMIN_USER.id)
  assert.equal(insert.payload.author_role, 'admin')
  assert.equal(insert.payload.kind, 'message')
  assert.equal(insert.payload.body, 'Documents look good')
  assert.equal(insert.payload.email_stub, 'email suppressed in tests')
  assert.equal(mail.state.calls.length, 1)
  assert.equal(mail.state.calls[0].to, 'ada@clemson.edu')
  assert.equal(mail.state.calls[0].subject, 'Message from Clemson RIDES admin')
  assert.equal(mail.state.calls[0].text, 'Documents look good')
  assert.equal(mail.state.calls[0].emailed, false)
  assert.equal(networkHits, 0)
})

test('applicant-message 404s when the applicant is missing and does not email', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=applicant-message',
    body: { profile_id: PROFILE_ID, body: 'Hello there' },
  })
  assert.equal(res.status, 404)
  assert.equal(res.json.error, 'Applicant not found')
  assert.equal(calls('driver_application_messages', 'insert').length, 0)
  assert.equal(mail.state.calls.length, 0)
})

test('info-request rejects a bad profile id and a short prompt', async () => {
  const badId = await invoke({
    method: 'POST',
    url: '/api/admin?action=info-request',
    body: { profileId: 'nope', prompt: 'Need the insurance card' },
  })
  assert.equal(badId.status, 400)
  assert.equal(badId.json.error, 'profileId must be a uuid')
  const short = await invoke({
    method: 'POST',
    url: '/api/admin?action=info-request',
    body: { profileId: PROFILE_ID, prompt: 'abc' },
  })
  assert.equal(short.status, 400)
  assert.match(short.json.error, /4.2000 characters/)
  assert.equal(http.state.client.calls.length, 0)
  assert.equal(mail.state.calls.length, 0)
})

test('info-request records the request and the thread note without sending email', async () => {
  const sb = createFakeSb()
  sb.when((ctx) => ctx.table === 'profiles', () => ({
    data: { id: PROFILE_ID, email: 'ada@clemson.edu', full_name: 'Ada' },
    error: null,
  }))
  sb.when((ctx) => ctx.table === 'driver_info_requests' && ctx.op === 'insert', () => ({
    data: { id: 'req-9', status: 'open', email_stub: 'stored', emailed_at: null },
    error: null,
  }))
  const prompt = 'Need a photo of the insurance card'
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=info-request',
    body: { profileId: PROFILE_ID, prompt: `  ${prompt}  ` },
    client: sb,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.emailed, false)
  assert.equal(res.json.email_todo, 'email suppressed in tests')
  assert.equal(res.json.request.id, 'req-9')
  const request = calls('driver_info_requests', 'insert')[0]
  assert.equal(request.payload.profile_id, PROFILE_ID)
  assert.equal(request.payload.requested_by, ADMIN_USER.id)
  assert.equal(request.payload.prompt, prompt)
  assert.equal(request.payload.status, 'open')
  assert.equal(request.payload.emailed_at, null)
  assert.match(request.payload.email_stub, /Need a photo of the insurance card/)
  const note = calls('driver_application_messages', 'insert')[0]
  assert.equal(note.payload.kind, 'info_request')
  assert.equal(note.payload.body, prompt)
  assert.equal(note.payload.author_role, 'admin')
  assert.equal(note.payload.email_stub, 'email suppressed in tests')
  assert.equal(mail.state.calls.length, 1)
  assert.equal(mail.state.calls[0].to, 'ada@clemson.edu')
  assert.equal(mail.state.calls[0].subject, 'Clemson RIDES needs more information')
  assert.match(mail.state.calls[0].text, /Need a photo of the insurance card/)
  assert.equal(networkHits, 0)
})

test('info-request 404s when the applicant is missing and does not email', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/api/admin?action=info-request',
    body: { profileId: PROFILE_ID, body: 'Please send the registration' },
  })
  assert.equal(res.status, 404)
  assert.equal(res.json.error, 'Applicant not found')
  assert.equal(calls('driver_info_requests', 'insert').length, 0)
  assert.equal(mail.state.calls.length, 0)
  assert.equal(networkHits, 0)
})
