import assert from 'node:assert/strict'
import test from 'node:test'
import * as accountDeletion from './accountDeletion.js'
import { ACCOUNT_DELETION_TICKET, buildAccountDeletionTicket } from './accountDeletion.js'
import { ACCOUNT_DELETION_TICKET as SHARED_ACCOUNT_DELETION_TICKET } from '../../shared/accountDeletion.js'
import { validateTicket } from '../../server/supportAgent.js'
import { supportTicketRequest } from './assistClient.js'

/**
 * In-memory fake Supabase client for testing database ticket operations
 * without network or real Postgres access.
 */
function createFakeSupabase({ tables = {}, errors = {} } = {}) {
  const store = {
    profiles: [...(tables.profiles || [])],
    support_tickets: [...(tables.support_tickets || [])],
  }

  function from(tableName) {
    if (!store[tableName]) {
      store[tableName] = []
    }

    let mode = 'select'
    let insertPayload = null
    const filters = []
    let orderSpec = null
    let limitCount = null

    const builder = {
      select() {
        mode = 'select'
        return builder
      },
      eq(col, val) {
        filters.push({ type: 'eq', col, val })
        return builder
      },
      order(col, options = {}) {
        orderSpec = { col, ascending: options.ascending !== false }
        return builder
      },
      limit(n) {
        limitCount = n
        return builder
      },
      insert(payload) {
        mode = 'insert'
        insertPayload = payload
        return builder
      },
      single() {
        return builder.then((res) => {
          if (res.error) return { data: null, error: res.error }
          const item = Array.isArray(res.data) ? res.data[0] : res.data
          if (!item) return { data: null, error: { message: 'Row not found' } }
          return { data: item, error: null }
        })
      },
      maybeSingle() {
        return builder.then((res) => {
          if (res.error) return { data: null, error: res.error }
          const item = Array.isArray(res.data) ? res.data[0] : res.data
          return { data: item || null, error: null }
        })
      },
      then(resolve) {
        if (errors[tableName]) {
          return resolve({ data: null, error: errors[tableName] })
        }

        if (mode === 'insert') {
          const items = Array.isArray(insertPayload) ? insertPayload : [insertPayload]
          const created = items.map((item, idx) => ({
            id: item.id || `ticket-${Date.now()}-${idx}`,
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          }))
          store[tableName].push(...created)
          return resolve({
            data: Array.isArray(insertPayload) ? created : created[0],
            error: null,
          })
        }

        let rows = [...store[tableName]]
        for (const f of filters) {
          if (f.type === 'eq') {
            rows = rows.filter((r) => r[f.col] === f.val)
          }
        }

        if (orderSpec) {
          rows.sort((a, b) => {
            if (a[orderSpec.col] < b[orderSpec.col]) return orderSpec.ascending ? -1 : 1
            if (a[orderSpec.col] > b[orderSpec.col]) return orderSpec.ascending ? 1 : -1
            return 0
          })
        }

        if (limitCount != null) {
          rows = rows.slice(0, limitCount)
        }

        return resolve({ data: rows, error: null })
      },
    }

    return builder
  }

  return {
    from,
    store,
  }
}

// ---------------------------------------------------------------------------
// 1. Module Exports & Contract
// ---------------------------------------------------------------------------

test('accountDeletion exports ACCOUNT_DELETION_TICKET identical to shared definition', () => {
  assert.ok(ACCOUNT_DELETION_TICKET, 'ACCOUNT_DELETION_TICKET should be defined')
  assert.equal(
    ACCOUNT_DELETION_TICKET,
    SHARED_ACCOUNT_DELETION_TICKET,
    'Re-export must reference the exact same shared object',
  )
})

test('accountDeletion exports expected public API (ACCOUNT_DELETION_TICKET and buildAccountDeletionTicket)', () => {
  const exportKeys = Object.keys(accountDeletion).sort()
  assert.deepEqual(exportKeys, ['ACCOUNT_DELETION_TICKET', 'buildAccountDeletionTicket'].sort())

  assert.equal(typeof accountDeletion.ACCOUNT_DELETION_TICKET, 'object')
  assert.equal(typeof accountDeletion.buildAccountDeletionTicket, 'function')
})

test('buildAccountDeletionTicket creates valid ticket with default parameters', () => {
  const ticket = buildAccountDeletionTicket()
  assert.equal(ticket.confirmed, true)
  assert.equal(ticket.category, 'account')
  assert.equal(ticket.roleVariant, 'rider')
  assert.equal(ticket.subject, 'Delete my Clemson RIDES account')
  assert.equal(
    ticket.body,
    `${ACCOUNT_DELETION_TICKET.body} Account email: on file.`,
  )

  const validated = validateTicket(ticket)
  assert.equal(validated.ok, true)
  assert.equal(validated.ticket.roleVariant, 'rider')
})

test('buildAccountDeletionTicket formats body with provided email string', () => {
  const ticket = buildAccountDeletionTicket({ email: 'student@clemson.edu' })
  assert.equal(
    ticket.body,
    `${ACCOUNT_DELETION_TICKET.body} Account email: student@clemson.edu.`,
  )

  const validated = validateTicket(ticket)
  assert.equal(validated.ok, true)
  assert.equal(validated.ticket.body, ticket.body)
})

test('buildAccountDeletionTicket normalizes empty, whitespace, null, or undefined email to on file', () => {
  for (const emptyVal of ['', '   ', null, undefined]) {
    const ticket = buildAccountDeletionTicket({ email: emptyVal })
    assert.equal(
      ticket.body,
      `${ACCOUNT_DELETION_TICKET.body} Account email: on file.`,
    )
    const validated = validateTicket(ticket)
    assert.equal(validated.ok, true)
  }
})

test('buildAccountDeletionTicket sets roleVariant to driver or rider safely', () => {
  const driverTicket = buildAccountDeletionTicket({
    email: 'driver@clemson.edu',
    roleVariant: 'driver',
    subject: 'Delete my Clemson RIDES driver account',
  })
  assert.equal(driverTicket.roleVariant, 'driver')
  assert.equal(driverTicket.subject, 'Delete my Clemson RIDES driver account')
  const driverValidated = validateTicket(driverTicket)
  assert.equal(driverValidated.ok, true)
  assert.equal(driverValidated.ticket.roleVariant, 'driver')

  // Non-driver role variants normalize to rider
  const otherTicket = buildAccountDeletionTicket({ roleVariant: 'other' })
  assert.equal(otherTicket.roleVariant, 'rider')
})

test('buildAccountDeletionTicket returns frozen immutable object', () => {
  const ticket = buildAccountDeletionTicket({ email: 'test@clemson.edu' })
  assert.equal(Object.isFrozen(ticket), true)
  assert.throws(() => {
    // @ts-expect-error Mutation attempt in strict mode
    ticket.confirmed = false
  }, TypeError)
})


// ---------------------------------------------------------------------------
// 2. Structure & Immutability of ACCOUNT_DELETION_TICKET
// ---------------------------------------------------------------------------

test('ACCOUNT_DELETION_TICKET contains expected fields and values', () => {
  assert.equal(ACCOUNT_DELETION_TICKET.confirmed, true)
  assert.equal(ACCOUNT_DELETION_TICKET.category, 'account')
  assert.equal(ACCOUNT_DELETION_TICKET.roleVariant, 'rider')
  assert.equal(ACCOUNT_DELETION_TICKET.subject, 'Delete my Clemson RIDES account')
  assert.equal(
    ACCOUNT_DELETION_TICKET.body,
    'Please delete my Clemson RIDES account and the trip history tied to it. I confirm this request from the product.',
  )

  // BUG?: roleVariant is hardcoded to 'rider' on the template, so driver deletion requests
  // default to rider roleVariant unless caller explicitly overrides it
  assert.equal(ACCOUNT_DELETION_TICKET.roleVariant, 'rider')
})

test('ACCOUNT_DELETION_TICKET is deeply immutable and frozen', () => {
  assert.equal(Object.isFrozen(ACCOUNT_DELETION_TICKET), true)
  assert.equal(Object.isSealed(ACCOUNT_DELETION_TICKET), true)

  assert.throws(() => {
    // @ts-expect-error Mutation attempt in strict mode
    ACCOUNT_DELETION_TICKET.confirmed = false
  }, TypeError)

  assert.throws(() => {
    // @ts-expect-error Mutation attempt in strict mode
    ACCOUNT_DELETION_TICKET.category = 'billing'
  }, TypeError)

  assert.throws(() => {
    // @ts-expect-error Adding property in strict mode
    ACCOUNT_DELETION_TICKET.userId = 'user-123'
  }, TypeError)

  assert.throws(() => {
    // @ts-expect-error Deleting property in strict mode
    delete ACCOUNT_DELETION_TICKET.roleVariant
  }, TypeError)
})

// ---------------------------------------------------------------------------
// 3. Ticket Validation against supportAgent validateTicket
// ---------------------------------------------------------------------------

test('validateTicket passes on the raw ACCOUNT_DELETION_TICKET template', () => {
  const result = validateTicket(ACCOUNT_DELETION_TICKET)
  assert.equal(result.ok, true)
  assert.equal(result.ticket.category, 'account')
  assert.equal(result.ticket.roleVariant, 'rider')
  assert.equal(result.ticket.subject, 'Delete my Clemson RIDES account')
  assert.equal(result.ticket.body, ACCOUNT_DELETION_TICKET.body)
})

test('validateTicket passes on rider app payload with user email appended', () => {
  // apps/rider/app/delete-account.tsx appends user email to body
  const payload = {
    ...ACCOUNT_DELETION_TICKET,
    body: `${ACCOUNT_DELETION_TICKET.body} Account email: testrider@clemson.edu.`,
  }
  const result = validateTicket(payload)
  assert.equal(result.ok, true)
  assert.equal(result.ticket.category, 'account')
  assert.equal(result.ticket.roleVariant, 'rider')
  assert.match(result.ticket.body, /Account email: testrider@clemson\.edu\./)
})

test('validateTicket handles missing auth email fallback', () => {
  // When user is not authenticated or email is missing, caller uses 'on file'
  const payload = {
    ...ACCOUNT_DELETION_TICKET,
    body: `${ACCOUNT_DELETION_TICKET.body} Account email: on file.`,
  }
  const result = validateTicket(payload)
  assert.equal(result.ok, true)

  // BUG?: Missing authentication is not prevented by ACCOUNT_DELETION_TICKET or validateTicket;
  // unauthenticated/anonymous callers can file a ticket with fallback 'Account email: on file'
  assert.match(result.ticket.body, /Account email: on file\./)
})

test('validateTicket supports overriding roleVariant to driver', () => {
  const driverPayload = {
    ...ACCOUNT_DELETION_TICKET,
    roleVariant: 'driver',
    subject: 'Delete my Clemson RIDES driver account',
    body: `${ACCOUNT_DELETION_TICKET.body} Account email: driver@clemson.edu.`,
  }
  const result = validateTicket(driverPayload)
  assert.equal(result.ok, true)
  assert.equal(result.ticket.roleVariant, 'driver')
  assert.equal(result.ticket.category, 'account')
})

test('validateTicket fails when confirmed is false or missing', () => {
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, confirmed: false }),
    { ok: false, error: 'Confirm the ticket in Support before it is filed.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, confirmed: undefined }),
    { ok: false, error: 'Confirm the ticket in Support before it is filed.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, confirmed: null }),
    { ok: false, error: 'Confirm the ticket in Support before it is filed.' },
  )
})

test('validateTicket fails when category is invalid or missing', () => {
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, category: 'unknown_category' }),
    { ok: false, error: 'Category must be bug, billing, ride dispute, account, safety, or other.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, category: '' }),
    { ok: false, error: 'Category must be bug, billing, ride dispute, account, safety, or other.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, category: null }),
    { ok: false, error: 'Category must be bug, billing, ride dispute, account, safety, or other.' },
  )
})

test('validateTicket fails when subject is too short or too long', () => {
  // Length < 4
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: 'Del' }),
    { ok: false, error: 'Subject should be 4–140 characters.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: '' }),
    { ok: false, error: 'Subject should be 4–140 characters.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: '   ' }),
    { ok: false, error: 'Subject should be 4–140 characters.' },
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: null }),
    { ok: false, error: 'Subject should be 4–140 characters.' },
  )

  // Length > 140
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: 'D'.repeat(141) }),
    { ok: false, error: 'Subject should be 4–140 characters.' },
  )

  // Boundary cases: exactly 4 and exactly 140 chars pass
  assert.equal(validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: '1234' }).ok, true)
  assert.equal(validateTicket({ ...ACCOUNT_DELETION_TICKET, subject: 'D'.repeat(140) }).ok, true)
})

test('validateTicket fails when body is too short or too long', () => {
  // Length < 8
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, body: '1234567' }),
    { ok: false, error: 'Add a short description before filing.' }
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, body: '' }),
    { ok: false, error: 'Add a short description before filing.' }
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, body: '       ' }),
    { ok: false, error: 'Add a short description before filing.' }
  )
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, body: null }),
    { ok: false, error: 'Add a short description before filing.' }
  )

  // Length > 4000
  assert.deepEqual(
    validateTicket({ ...ACCOUNT_DELETION_TICKET, body: 'B'.repeat(4001) }),
    { ok: false, error: 'Add a short description before filing.' }
  )

  // Boundary cases: exactly 8 and exactly 4000 chars pass
  assert.equal(validateTicket({ ...ACCOUNT_DELETION_TICKET, body: '12345678' }).ok, true)
  assert.equal(validateTicket({ ...ACCOUNT_DELETION_TICKET, body: 'B'.repeat(4000) }).ok, true)
})

test('validateTicket handles null or undefined input gracefully', () => {
  assert.deepEqual(
    validateTicket(null),
    { ok: false, error: 'Confirm the ticket in Support before it is filed.' }
  )
  assert.deepEqual(
    validateTicket(undefined),
    { ok: false, error: 'Confirm the ticket in Support before it is filed.' }
  )
})

// ---------------------------------------------------------------------------
// 4. In-Memory Fake Supabase Ticket Submission & Lifecycle
// ---------------------------------------------------------------------------

test('fake supabase stores account deletion ticket on happy path', async () => {
  const supabase = createFakeSupabase({
    tables: {
      profiles: [{ id: 'user-42', email: 'rider@clemson.edu', role: 'rider' }],
    },
  })

  const validated = validateTicket({
    ...ACCOUNT_DELETION_TICKET,
    body: `${ACCOUNT_DELETION_TICKET.body} Account email: rider@clemson.edu.`,
  })
  assert.equal(validated.ok, true)

  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: 'user-42',
      role_variant: validated.ticket.roleVariant,
      category: validated.ticket.category,
      subject: validated.ticket.subject,
      body: validated.ticket.body,
      status: 'open',
    })
    .single()

  assert.equal(error, null)
  assert.ok(data?.id)
  assert.equal(data.user_id, 'user-42')
  assert.equal(data.category, 'account')
  assert.equal(data.role_variant, 'rider')
  assert.equal(data.status, 'open')

  // Verify store state
  assert.equal(supabase.store.support_tickets.length, 1)
  assert.equal(supabase.store.support_tickets[0].id, data.id)
})

test('fake supabase isolates user tickets on query', async () => {
  const supabase = createFakeSupabase({
    tables: {
      support_tickets: [
        { id: 't1', user_id: 'user-1', category: 'account', subject: 'Delete my account' },
        { id: 't2', user_id: 'user-2', category: 'account', subject: 'Delete user 2 account' },
      ],
    },
  })

  const { data, error } = await supabase
    .from('support_tickets')
    .select()
    .eq('user_id', 'user-1')

  assert.equal(error, null)
  assert.equal(data.length, 1)
  assert.equal(data[0].id, 't1')
})

test('fake supabase returns error when database operation fails', async () => {
  const supabase = createFakeSupabase({
    errors: {
      support_tickets: { message: 'relation support_tickets does not exist' },
    },
  })

  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: 'user-1',
      category: 'account',
      subject: ACCOUNT_DELETION_TICKET.subject,
      body: ACCOUNT_DELETION_TICKET.body,
    })

  assert.equal(data, null)
  assert.equal(error?.message, 'relation support_tickets does not exist')
})

// ---------------------------------------------------------------------------
// 5. supportTicketRequest HTTP Client with ACCOUNT_DELETION_TICKET
// ---------------------------------------------------------------------------

test('supportTicketRequest succeeds on happy path with deletion ticket', async () => {
  const originalFetch = globalThis.fetch
  let capturedRequest = null

  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ticket: { id: 'ticket-999', status: 'bot_handling' },
      }),
    }
  }

  try {
    const data = await supportTicketRequest({
      url: 'https://example.com/api/admin-drivers?action=ticket',
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt-token' },
      body: {
        ...ACCOUNT_DELETION_TICKET,
        body: `${ACCOUNT_DELETION_TICKET.body} Account email: rider@clemson.edu.`,
      },
    })

    assert.equal(data.ticket?.id, 'ticket-999')
    assert.equal(capturedRequest.url, 'https://example.com/api/admin-drivers?action=ticket')
    assert.equal(capturedRequest.options.method, 'POST')
    assert.equal(capturedRequest.options.headers.Authorization, 'Bearer test-jwt-token')

    const sentBody = JSON.parse(capturedRequest.options.body)
    assert.equal(sentBody.category, 'account')
    assert.equal(sentBody.confirmed, true)
    assert.match(sentBody.body, /rider@clemson\.edu/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('supportTicketRequest throws when authentication is missing (401)', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Sign in required' }),
  })

  try {
    await assert.rejects(
      () =>
        supportTicketRequest({
          url: 'https://example.com/api/admin-drivers?action=ticket',
          method: 'POST',
          headers: {}, // Missing authorization header
          body: { ...ACCOUNT_DELETION_TICKET },
        }),
      (err) => {
        assert.equal(err.message, 'Sign in required')
        assert.deepEqual(err.payload, { error: 'Sign in required' })
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('supportTicketRequest throws on server 500 error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'Could not file the ticket.' }),
  })

  try {
    await assert.rejects(
      () =>
        supportTicketRequest({
          url: 'https://example.com/api/admin-drivers?action=ticket',
          method: 'POST',
          body: { ...ACCOUNT_DELETION_TICKET },
        }),
      (err) => {
        assert.equal(err.message, 'Could not file the ticket.')
        assert.deepEqual(err.payload, { error: 'Could not file the ticket.' })
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('supportTicketRequest throws on rate limit 429 error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'Too many tickets. Wait a few minutes or email rides@clemson.edu.' }),
  })

  try {
    await assert.rejects(
      () =>
        supportTicketRequest({
          url: 'https://example.com/api/admin-drivers?action=ticket',
          method: 'POST',
          body: { ...ACCOUNT_DELETION_TICKET },
        }),
      /Too many tickets/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('supportTicketRequest falls back to status error string when response is not JSON', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error('Invalid JSON')
    },
  })

  try {
    await assert.rejects(
      () =>
        supportTicketRequest({
          url: 'https://example.com/api/admin-drivers?action=ticket',
          method: 'POST',
          body: { ...ACCOUNT_DELETION_TICKET },
        }),
      /Request failed \(502\)/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
