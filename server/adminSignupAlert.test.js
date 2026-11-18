import assert from 'node:assert/strict'
import test from 'node:test'
import handler from './endpoints/adminSignupAlert.js'
import {
  ADMIN_SIGNUP_USER_ID,
  adminSignupCopy,
  adminSignupRecipientId,
  deliverAdminSignupAlert,
} from './adminSignupAlert.js'

const JOHN = 'f2262bf6-1fef-4d90-9e2e-7edfb7f097dc'

function memorySb(seed = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))
  function rowsOf(table) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }
  return {
    tables,
    from(table) {
      const state = { op: 'select', payload: null, filters: [] }
      const api = {
        select() { return api },
        eq(col, val) { state.filters.push([col, val]); return api },
        insert(payload) { state.op = 'insert'; state.payload = payload; return api },
        update(payload) { state.op = 'update'; state.payload = payload; return api },
        delete() { state.op = 'delete'; return api },
        maybeSingle() {
          const found = rowsOf(table).filter((row) => state.filters.every(([col, val]) => row[col] === val))
          return Promise.resolve({ data: found[0] ? { ...found[0] } : null, error: null })
        },
        then(resolve) {
          const match = (row) => state.filters.every(([col, val]) => row[col] === val)
          if (state.op === 'insert') {
            rowsOf(table).push({ ...state.payload })
            resolve({ data: { ...state.payload }, error: null })
            return
          }
          if (state.op === 'delete') {
            tables[table] = rowsOf(table).filter((row) => !match(row))
          }
          if (state.op === 'update') {
            rowsOf(table).filter(match).forEach((row) => Object.assign(row, state.payload))
          }
          resolve({ data: rowsOf(table).filter(match), error: null })
        },
      }
      return api
    },
  }
}

function response() {
  return {
    statusCode: 0,
    body: '',
    headers: {},
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value },
    end(payload) { this.body = payload; this.writableEnded = true },
  }
}

test('signup copy and the recipient stay on the admin account', () => {
  assert.equal(ADMIN_SIGNUP_USER_ID, JOHN)
  assert.equal(adminSignupRecipientId(), JOHN)
  assert.equal(adminSignupCopy({ fullName: 'Ada Lovelace', email: 'ada@clemson.edu' }).body, 'Ada Lovelace (ada@clemson.edu) just signed up.')
  assert.equal(adminSignupCopy({}).title, 'New Clemson Rides account')
})

test('a new account notifies only John, including when other drivers have tokens', async () => {
  const sb = memorySb({
    driver_push_tokens: [
      { driver_id: 'driver-other', token: 'ExponentPushToken[other]' },
      { driver_id: JOHN, token: 'ExponentPushToken[john]' },
    ],
    profiles: [{ id: JOHN, email: 'johnmatveyev@gmail.com' }],
  })
  const sent = []
  const result = await deliverAdminSignupAlert(sb, {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'new@clemson.edu',
    fullName: 'New Rider',
    source: 'auth.users',
    recipientId: 'driver-other',
  }, {
    sendExpoPush: async (message) => {
      sent.push(message)
      return { sent: true, reason: 'sent' }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.pushed, true)
  assert.equal(result.recipientId, JOHN)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'ExponentPushToken[john]')
  assert.equal(sent[0].sound, 'default')
  assert.equal(sent[0].data.kind, 'admin_signup')
  assert.equal(sent[0].data.signup_user_id, '11111111-1111-4111-8111-111111111111')
  assert.equal(sb.tables.driver_notifications.length, 1)
  assert.equal(sb.tables.driver_notifications[0].user_id, JOHN)
  assert.equal(sb.tables.driver_notifications[0].type, 'admin_signup')
  assert.equal(sb.tables.driver_notifications.some((row) => row.user_id === 'driver-other'), false)

  const again = await deliverAdminSignupAlert(sb, {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'new@clemson.edu',
  }, {
    sendExpoPush: async (message) => {
      sent.push(message)
      return { sent: true, reason: 'sent' }
    },
  })
  assert.equal(again.recorded, 'duplicate')
  assert.equal(sb.tables.driver_notifications.length, 1)
})

test('the signup endpoint requires the cron bearer and does not push other drivers', async () => {
  const sb = memorySb({
    driver_push_tokens: [{ driver_id: JOHN, token: 'ExponentPushToken[john]' }],
  })
  const sent = []
  const deps = {
    sb,
    env: { CRON_SECRET: 'cron-test-secret' },
    sendExpoPush: async (message) => {
      sent.push(message)
      return { sent: true, reason: 'sent' }
    },
  }
  const denied = response()
  await handler({ method: 'POST', url: '/api/driver?action=admin-signup-alert', headers: {}, body: { userId: 'rider-1' } }, denied, deps)
  assert.equal(denied.statusCode, 401)
  assert.equal(sent.length, 0)

  const ok = response()
  await handler({
    method: 'POST',
    url: '/api/driver?action=admin-signup-alert',
    headers: { authorization: 'Bearer cron-test-secret' },
    body: { userId: '22222222-2222-4222-8222-222222222222', email: 'rider@clemson.edu', fullName: 'Rider' },
  }, ok, deps)
  assert.equal(ok.statusCode, 200)
  const payload = JSON.parse(ok.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.pushed, true)
  assert.equal(payload.recipientId, JOHN)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'ExponentPushToken[john]')
  assert.equal(JSON.stringify(payload).includes('ExponentPushToken'), false)
  assert.equal(JSON.stringify(payload).includes('cron-test-secret'), false)
})
