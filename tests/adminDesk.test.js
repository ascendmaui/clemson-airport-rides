import assert from 'node:assert/strict'
import test from 'node:test'
import adminHandler from '../server/endpoints/adminDesk.js'
import apiAdminHandler from '../api/admin.js'

function createFakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val
    },
    end(data) {
      this.body = data
    },
    get json() {
      try {
        return JSON.parse(this.body)
      } catch {
        return null
      }
    },
  }
}

function createFakeRequest({ method = 'GET', url = '/api/admin?action=overview', body = null } = {}) {
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    body,
  }
}

function mockSb(initialTables = {}) {
  const tables = {
    profiles: [],
    driver_applications: [],
    admin_notifications: [],
    support_tickets: [],
    support_ticket_messages: [],
    driver_application_messages: [],
    driver_info_requests: [],
    trips: [],
    ...initialTables,
  }

  return {
    _tables: tables,
    from(table) {
      if (!tables[table]) tables[table] = []
      const filters = []
      let limitCount = null

      const chain = {
        select(cols, opts = {}) {
          if (opts.head && opts.count === 'exact') {
            return {
              eq(col, val) {
                filters.push({ col, op: 'eq', val })
                return this
              },
              neq(col, val) {
                filters.push({ col, op: 'neq', val })
                return this
              },
              is(col, val) {
                filters.push({ col, op: 'is', val })
                return this
              },
              then(resolve) {
                const count = tables[table].filter((r) =>
                  filters.every((f) => {
                    if (f.op === 'eq') return r[f.col] === f.val
                    if (f.op === 'neq') return r[f.col] !== f.val
                    if (f.op === 'is') return f.val === null ? r[f.col] == null : r[f.col] === f.val
                    return true
                  })
                ).length
                resolve({ count, data: null, error: null })
              },
            }
          }
          return chain
        },
        eq(col, val) {
          filters.push({ col, op: 'eq', val })
          return chain
        },
        neq(col, val) {
          filters.push({ col, op: 'neq', val })
          return chain
        },
        is(col, val) {
          filters.push({ col, op: 'is', val })
          return chain
        },
        in(col, vals) {
          filters.push({ col, op: 'in', val: vals })
          return chain
        },
        order() {
          return chain
        },
        limit(n) {
          limitCount = n
          return chain
        },
        then(resolve) {
          let rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              if (f.op === 'neq') return r[f.col] !== f.val
              if (f.op === 'is') return f.val === null ? r[f.col] == null : r[f.col] === f.val
              if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(r[f.col])
              return true
            })
          )
          if (limitCount != null) rows = rows.slice(0, limitCount)
          resolve({ data: rows, error: null })
        },
        async maybeSingle() {
          const rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              if (f.op === 'neq') return r[f.col] !== f.val
              if (f.op === 'is') return f.val === null ? r[f.col] == null : r[f.col] === f.val
              if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(r[f.col])
              return true
            })
          )
          return { data: rows[0] || null, error: null }
        },
        async single() {
          const res = await chain.maybeSingle()
          if (!res.data) return { data: null, error: { message: 'Row not found' } }
          return res
        },
        insert(rowOrRows) {
          const inserted = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          for (const item of inserted) {
            const entry = { id: item.id || `gen-${Math.random().toString(36).slice(2, 9)}`, ...item }
            tables[table].push(entry)
          }
          return {
            select() {
              return {
                maybeSingle: async () => ({ data: tables[table].at(-1), error: null }),
                single: async () => ({ data: tables[table].at(-1), error: null }),
              }
            },
            then(resolve) {
              resolve({ data: tables[table].at(-1), error: null })
            },
          }
        },
        update(patch) {
          const updateChain = {
            eq(col, val) {
              filters.push({ col, op: 'eq', val })
              return updateChain
            },
            is(col, val) {
              filters.push({ col, op: 'is', val })
              return updateChain
            },
            select() {
              return {
                maybeSingle: async () => {
                  const matched = tables[table].filter((r) =>
                    filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : true))
                  )
                  for (const row of matched) Object.assign(row, patch)
                  return { data: matched[0] || null, error: null }
                },
              }
            },
            then(resolve) {
              const matched = tables[table].filter((r) =>
                filters.every((f) => {
                  if (f.op === 'eq') return r[f.col] === f.val
                  if (f.op === 'is') return f.val === null ? r[f.col] == null : r[f.col] === f.val
                  return true
                })
              )
              for (const row of matched) Object.assign(row, patch)
              resolve({ data: matched, error: null })
            },
          }
          return updateChain
        },
      }

      return chain
    },
  }
}

test('adminDesk: rejects invalid actions, wrong HTTP methods, missing sb, unauth, non-admin', async () => {
  const sb = mockSb()
  const adminUser = { id: 'admin-1', email: 'admin@clemson.edu' }
  const normalUser = { id: 'rider-1', email: 'rider@clemson.edu' }

  // Unknown action
  const resBadAction = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=hack' }), resBadAction)
  assert.equal(resBadAction.statusCode, 400)
  assert.match(resBadAction.json.error, /Unknown admin action/i)

  // Wrong method for GET action
  const resWrongMethodGet = createFakeResponse()
  await adminHandler(createFakeRequest({ method: 'POST', url: '/api/admin?action=overview' }), resWrongMethodGet)
  assert.equal(resWrongMethodGet.statusCode, 405)

  // Wrong method for POST action
  const resWrongMethodPost = createFakeResponse()
  await adminHandler(createFakeRequest({ method: 'GET', url: '/api/admin?action=mark-notification' }), resWrongMethodPost)
  assert.equal(resWrongMethodPost.statusCode, 405)

  // Missing sb
  const resNoSb = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=overview' }), resNoSb, { sb: null })
  assert.equal(resNoSb.statusCode, 503)

  // Missing user
  const resNoUser = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=overview' }), resNoUser, { sb, user: null })
  assert.equal(resNoUser.statusCode, 401)

  // Non-admin user
  const resNonAdmin = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=overview' }), resNonAdmin, {
    sb,
    user: normalUser,
    staffAccess: async () => ({ admin: false, support: false }),
  })
  assert.equal(resNonAdmin.statusCode, 403)
  assert.equal(resNonAdmin.json.error, 'Admin only')
})

test('adminDesk read actions: overview, notifications, people, trips', async () => {
  const sb = mockSb({
    driver_applications: [
      { id: 'app-1', onboarding_status: 'pending_review' },
      { id: 'app-2', onboarding_status: 'approved' },
    ],
    admin_notifications: [
      { id: 'notif-1', title: 'New driver', body: 'Driver signed up', read_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 'notif-2', title: 'Old driver', body: 'Signed up long ago', read_at: '2026-10-01T01:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    ],
    support_tickets: [
      { id: 'ticket-1', status: 'escalated' },
      { id: 'ticket-2', status: 'open' },
      { id: 'ticket-3', status: 'resolved' },
    ],
    profiles: [
      { id: 'admin-1', full_name: 'Admin User', email: 'admin@clemson.edu', role: 'admin', is_admin: true },
      { id: 'driver-1', full_name: 'Driver Dave', email: 'driver@clemson.edu', role: 'driver', is_admin: false },
      { id: 'rider-1', full_name: 'Rider Rachel', email: 'rider@clemson.edu', role: 'rider', is_admin: false },
    ],
    trips: [
      {
        id: 'trip-1',
        status: 'completed',
        rider_id: 'rider-1',
        driver_id: 'driver-1',
        pickup_label: 'Cooper Library',
        dropoff_label: 'GSP Airport',
        fare_cents: 4500,
        tier: 'standard',
      },
    ],
  })

  const adminUser = { id: 'admin-1', email: 'admin@clemson.edu' }
  const deps = { sb, user: adminUser, staffAccess: async () => ({ admin: true, support: true }) }

  // 1. Overview
  const resOverview = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=overview' }), resOverview, deps)
  assert.equal(resOverview.statusCode, 200)
  assert.equal(resOverview.json.pendingApplications, 1)
  assert.equal(resOverview.json.unreadNotifications, 1)
  assert.equal(resOverview.json.escalatedTickets, 1)
  assert.equal(resOverview.json.activeTickets, 2)
  assert.equal(resOverview.json.migrationRequired, false)

  // 2. Notifications
  const resNotif = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=notifications' }), resNotif, deps)
  assert.equal(resNotif.statusCode, 200)
  assert.equal(resNotif.json.notifications.length, 2)

  // 3. People (all and filtered)
  const resPeople = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=people' }), resPeople, deps)
  assert.equal(resPeople.statusCode, 200)
  assert.equal(resPeople.json.people.length, 3)

  const resDrivers = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=people&role=driver' }), resDrivers, deps)
  assert.equal(resDrivers.statusCode, 200)
  assert.equal(resDrivers.json.people.length, 1)
  assert.equal(resDrivers.json.people[0].email, 'driver@clemson.edu')

  // 4. Trips
  const resTrips = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=trips' }), resTrips, deps)
  assert.equal(resTrips.statusCode, 200)
  assert.equal(resTrips.json.trips.length, 1)
  assert.equal(resTrips.json.trips[0].rider.full_name, 'Rider Rachel')
  assert.equal(resTrips.json.trips[0].driver.full_name, 'Driver Dave')
})

test('adminDesk read actions: tickets and applicant-thread', async () => {
  const ticketId = '11111111-1111-4111-8111-111111111111'
  const applicantId = '22222222-2222-4222-8222-222222222222'

  const sb = mockSb({
    support_tickets: [
      { id: ticketId, user_id: 'rider-1', subject: 'Lost item', status: 'open' },
    ],
    support_ticket_messages: [
      { id: 'msg-1', ticket_id: ticketId, body: 'I left my jacket', author_role: 'rider' },
    ],
    profiles: [
      { id: 'rider-1', full_name: 'Rider Rachel', email: 'rider@clemson.edu' },
      { id: applicantId, full_name: 'Applicant Alex', email: 'alex@clemson.edu' },
    ],
    driver_application_messages: [
      { id: 'appmsg-1', profile_id: applicantId, body: 'Checking on status' },
    ],
    driver_info_requests: [
      { id: 'req-1', profile_id: applicantId, prompt: 'Upload insurance', status: 'open' },
    ],
  })

  const deps = { sb, user: { id: 'admin-1' }, staffAccess: async () => ({ admin: true, support: true }) }

  // Tickets list
  const resTicketsList = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=tickets' }), resTicketsList, deps)
  assert.equal(resTicketsList.statusCode, 200)
  assert.equal(resTicketsList.json.tickets.length, 1)

  // Ticket by bad id
  const resBadId = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=tickets&id=not-a-uuid' }), resBadId, deps)
  assert.equal(resBadId.statusCode, 400)
  assert.match(resBadId.json.error, /must be a uuid/i)

  // Ticket by valid id
  const resTicketDetail = createFakeResponse()
  await adminHandler(createFakeRequest({ url: `/api/admin?action=tickets&id=${ticketId}` }), resTicketDetail, deps)
  assert.equal(resTicketDetail.statusCode, 200)
  assert.equal(resTicketDetail.json.ticket.id, ticketId)
  assert.equal(resTicketDetail.json.messages.length, 1)
  assert.equal(resTicketDetail.json.profile.email, 'rider@clemson.edu')

  // Applicant thread by bad uuid
  const resBadAppId = createFakeResponse()
  await adminHandler(createFakeRequest({ url: '/api/admin?action=applicant-thread&profile_id=invalid' }), resBadAppId, deps)
  assert.equal(resBadAppId.statusCode, 400)

  // Applicant thread by valid uuid
  const resAppThread = createFakeResponse()
  await adminHandler(createFakeRequest({ url: `/api/admin?action=applicant-thread&profile_id=${applicantId}` }), resAppThread, deps)
  assert.equal(resAppThread.statusCode, 200)
  assert.equal(resAppThread.json.messages.length, 1)
  assert.equal(resAppThread.json.requests.length, 1)
})

test('adminDesk write actions: mark-notification, ticket-reply, applicant-message, info-request', async () => {
  const notifId = '33333333-3333-4333-8333-333333333333'
  const ticketId = '44444444-4444-4444-8444-444444444444'
  const applicantId = '55555555-5555-4555-8555-555555555555'

  const sb = mockSb({
    admin_notifications: [
      { id: notifId, read_at: null },
      { id: 'notif-2', read_at: null },
    ],
    support_tickets: [
      { id: ticketId, user_id: 'rider-1', status: 'open' },
    ],
    profiles: [
      { id: applicantId, email: 'app@clemson.edu', full_name: 'App User' },
    ],
  })

  let noticed = []
  const fakeNotice = async (params) => {
    noticed.push(params)
    return { emailed: true, id: 'resend-123', stub: null, todo: null }
  }

  const deps = {
    sb,
    user: { id: 'admin-1', email: 'admin@clemson.edu' },
    staffAccess: async () => ({ admin: true, support: true }),
    sendApplicantNotice: fakeNotice,
  }

  // 1. Mark single notification
  const resMarkOne = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=mark-notification',
    body: { id: notifId },
  }), resMarkOne, deps)
  assert.equal(resMarkOne.statusCode, 200)
  assert.equal(resMarkOne.json.ok, true)
  assert.ok(sb._tables.admin_notifications.find((n) => n.id === notifId).read_at)

  // Mark all notifications
  const resMarkAll = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=mark-notification',
    body: { all: true },
  }), resMarkAll, deps)
  assert.equal(resMarkAll.statusCode, 200)
  assert.ok(sb._tables.admin_notifications.find((n) => n.id === 'notif-2').read_at)

  // 2. Ticket reply validation & execution
  const resBadReply = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId: 'not-a-uuid', body: 'Valid body' },
  }), resBadReply, deps)
  assert.equal(resBadReply.statusCode, 400)

  const resEmptyReply = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId, body: '   ' },
  }), resEmptyReply, deps)
  assert.equal(resEmptyReply.statusCode, 400)

  const resOkReply = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=ticket-reply',
    body: { ticketId, body: 'We are investigating your lost item.', status: 'waiting_user' },
  }), resOkReply, deps)
  assert.equal(resOkReply.statusCode, 200)
  assert.equal(resOkReply.json.ok, true)
  assert.equal(resOkReply.json.ticket.status, 'waiting_user')
  assert.equal(sb._tables.support_ticket_messages.length, 1)

  // 3. Applicant message
  const resAppMsg = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=applicant-message',
    body: { profileId: applicantId, body: 'Welcome to the team!' },
  }), resAppMsg, deps)
  assert.equal(resAppMsg.statusCode, 200)
  assert.equal(resAppMsg.json.ok, true)
  assert.equal(resAppMsg.json.emailed, true)
  assert.equal(noticed.length, 1)
  assert.equal(noticed[0].to, 'app@clemson.edu')

  // 4. Info request
  const resInfoReq = createFakeResponse()
  await adminHandler(createFakeRequest({
    method: 'POST',
    url: '/api/admin?action=info-request',
    body: { profileId: applicantId, prompt: 'Please provide proof of vehicle registration.' },
  }), resInfoReq, deps)
  assert.equal(resInfoReq.statusCode, 200)
  assert.equal(resInfoReq.json.ok, true)
  assert.equal(resInfoReq.json.request.status, 'open')
  assert.equal(noticed.length, 2)
  assert.match(noticed[1].subject, /needs more information/i)
})

test('apiAdminHandler router re-export: delegates directly to adminDesk', async () => {
  const sb = mockSb()
  const deps = { sb, user: { id: 'admin-1' }, staffAccess: async () => ({ admin: true, support: true }) }

  const res = createFakeResponse()
  await apiAdminHandler(createFakeRequest({ url: '/api/admin?action=overview' }), res, deps)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.inbox, 'support_tickets')
})
