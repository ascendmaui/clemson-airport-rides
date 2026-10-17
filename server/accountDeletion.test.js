import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import handler from './endpoints/account.js'
import {
  DELETED_NAME,
  GUEST_DELETE_ERROR,
  HOLD_RELEASE_ERROR,
  SUBSCRIPTION_CANCEL_ERROR,
  TRIP_IN_PROGRESS_ERROR,
  deleteAccount,
  deletedEmail,
} from './accountDeletion.js'
import { APPLE_NOT_CONFIGURED_WARNING } from './appleRevoke.js'

const RIDER = '11111111-1111-4111-8111-111111111111'
const DRIVER = '22222222-2222-4222-8222-222222222222'

function memoryDb(tables = {}, { deleteUser } = {}) {
  const calls = []
  function rowsOf(table) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }
  function chain(table) {
    const state = { op: 'select', filters: [], patch: null }
    const match = (row) => state.filters.every(([key, value]) => (
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value
    ))
    const api = {
      select() { state.op = 'select'; return api },
      update(patch) { state.op = 'update'; state.patch = patch; return api },
      delete() { state.op = 'delete'; return api },
      eq(key, value) { state.filters.push([key, value]); return api },
      in(key, value) { state.filters.push([key, value]); return api },
      then(resolve, reject) {
        try {
          const current = rowsOf(table)
          const matched = current.filter(match)
          let data = null
          if (state.op === 'select') data = matched.map((row) => ({ ...row }))
          if (state.op === 'update') {
            for (const row of matched) Object.assign(row, structuredClone(state.patch))
            calls.push({ table, op: 'update', patch: state.patch, count: matched.length })
          }
          if (state.op === 'delete') {
            tables[table] = current.filter((row) => !match(row))
            calls.push({ table, op: 'delete', count: matched.length })
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        } catch (error) {
          return Promise.reject(error).then(resolve, reject)
        }
      },
    }
    return api
  }
  return {
    tables,
    calls,
    from: (table) => chain(table),
    auth: {
      admin: {
        deleteUser: deleteUser || (async (id) => {
          calls.push({ op: 'deleteUser', id })
          return { data: { user: { id } }, error: null }
        }),
      },
    },
  }
}

function stripeMock(intents = {}) {
  const canceled = []
  const subs = []
  const customers = []
  return {
    canceled,
    subs,
    customerUpdates: customers,
    paymentIntents: {
      async retrieve(id) { return intents[id] || { id, status: 'requires_capture' } },
      async cancel(id) { canceled.push(id); return { id, status: 'canceled' } },
    },
    subscriptions: {
      async cancel(id) { subs.push(id); return { id, status: 'canceled' } },
    },
    customers: {
      async update(id, patch) { customers.push({ id, patch }); return { id } },
    },
  }
}

function user(id, extra = {}) {
  return { id, email: `${id}@clemson.edu`, ...extra }
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
      this.writableEnded = true
    },
  }
}

async function invoke(req, deps) {
  const res = mockRes()
  await handler({ method: 'POST', url: '/api/account?action=delete', body: {}, ...req }, res, deps)
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : {} }
}

test('a driver with a trip in progress cannot delete and nothing is mutated', async () => {
  const sb = memoryDb({
    trips: [{ id: 'trip-live', status: 'in_progress', rider_id: RIDER, driver_id: DRIVER, metadata: {}, fare_cents: 1800 }],
    profiles: [{ id: DRIVER, full_name: 'Dana Driver', email: 'dana@clemson.edu', stripe_customer_id: 'cus_d' }],
  })
  const result = await deleteAccount(sb, user(DRIVER), { stripe: stripeMock(), env: {}, warn() {} })
  assert.equal(result.blocked, true)
  assert.equal(result.status, 409)
  assert.equal(result.error, TRIP_IN_PROGRESS_ERROR)
  assert.equal(sb.calls.some((call) => call.op === 'deleteUser'), false)
  assert.equal(sb.tables.trips[0].status, 'in_progress')
  assert.equal(sb.tables.profiles[0].full_name, 'Dana Driver')
})

test('a rider trip in progress is canceled and the open card hold is released', async () => {
  const sb = memoryDb({
    trips: [{
      id: 'trip-rider',
      status: 'in_progress',
      rider_id: RIDER,
      driver_id: DRIVER,
      fare_cents: 2200,
      metadata: { fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_hold' } },
    }],
    payments: [
      { id: 'pay-open', trip_id: 'trip-rider', status: 'requires_capture', stripe_payment_intent_id: 'pi_hold' },
      { id: 'pay-done', trip_id: 'trip-rider', status: 'succeeded', stripe_payment_intent_id: 'pi_done' },
    ],
    profiles: [{ id: RIDER, full_name: 'Riley', email: 'riley@clemson.edu', phone: '8645550100', stripe_customer_id: 'cus_r' }],
  })
  const stripe = stripeMock({
    pi_hold: { id: 'pi_hold', status: 'requires_capture' },
    pi_done: { id: 'pi_done', status: 'succeeded' },
  })
  const released = []
  const result = await deleteAccount(sb, user(RIDER), {
    stripe,
    env: {},
    warn() {},
    releaseHold: async ({ trip }) => { released.push(trip.id); return { ok: true, released: true } },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(released, ['trip-rider'])
  assert.deepEqual(stripe.canceled, ['pi_hold'])
  assert.equal(sb.tables.trips[0].status, 'canceled')
  assert.equal(sb.tables.payments.find((row) => row.id === 'pay-open').status, 'canceled')
  assert.equal(sb.tables.payments.find((row) => row.id === 'pay-done').status, 'succeeded')
  assert.equal(sb.calls.some((call) => call.op === 'deleteUser' && call.id === RIDER), true)
})

test('an assigned driver trip returns to the pool and the rider card hold stays', async () => {
  const sb = memoryDb({
    trips: [
      { id: 'trip-soon', status: 'accepted', rider_id: RIDER, driver_id: DRIVER, fare_cents: 1500, metadata: { fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_keep' } } },
      { id: 'trip-later', status: 'scheduled', rider_id: RIDER, driver_id: DRIVER, fare_cents: 1500, metadata: {} },
    ],
    profiles: [{ id: DRIVER, full_name: 'Dana', email: 'dana@clemson.edu' }],
  })
  const stripe = stripeMock()
  const released = []
  await deleteAccount(sb, user(DRIVER), {
    stripe,
    env: {},
    warn() {},
    releaseHold: async ({ trip }) => { released.push(trip.id); return { ok: true } },
  })
  const soon = sb.tables.trips.find((row) => row.id === 'trip-soon')
  const later = sb.tables.trips.find((row) => row.id === 'trip-later')
  assert.equal(soon.status, 'searching')
  assert.equal(soon.driver_id, null)
  assert.equal(later.status, 'scheduled')
  assert.equal(later.driver_id, null)
  assert.deepEqual(released, [])
  assert.deepEqual(stripe.canceled, [])
})

test('Tiger Pass and Student subscriptions are canceled immediately', async () => {
  const sb = memoryDb({
    trips: [],
    profiles: [{ id: RIDER, full_name: 'Riley', email: 'riley@clemson.edu' }],
    rider_subscriptions: [{ rider_id: RIDER, status: 'active', stripe_subscription_id: 'sub_tiger' }],
    student_plan_subscriptions: [{ rider_id: RIDER, status: 'trialing', stripe_subscription_id: 'sub_student' }],
  })
  const stripe = stripeMock()
  await deleteAccount(sb, user(RIDER), { stripe, env: {}, warn() {} })
  assert.deepEqual(stripe.subs.sort(), ['sub_student', 'sub_tiger'])
  assert.equal(sb.tables.rider_subscriptions[0].status, 'canceled')
  assert.equal(sb.tables.student_plan_subscriptions[0].status, 'canceled')
  assert.equal(sb.tables.student_plan_subscriptions[0].cancel_at_period_end, false)
})

test('profile contact data, chat, and push tokens are removed and tax rows stay', async () => {
  const sb = memoryDb({
    trips: [{ id: 'trip-done', status: 'completed', rider_id: RIDER, driver_id: DRIVER, fare_cents: 1900, metadata: {} }],
    profiles: [{
      id: RIDER,
      full_name: 'Riley Rider',
      email: 'riley@clemson.edu',
      phone: '8645550100',
      bio: 'Go tigers',
      avatar_url: 'https://example.com/a.jpg',
      favorite_spots: ['Library'],
      expo_push_token: 'ExponentPushToken[abc]',
      stripe_customer_id: 'cus_r',
      stripe_default_pm_id: 'pm_1',
    }],
    rider_push_tokens: [{ rider_id: RIDER, token: 'ExponentPushToken[abc]' }],
    saved_places: [{ user_id: RIDER, label: 'Home' }],
    trip_messages: [{ sender_id: RIDER, body: 'I am outside the library' }],
    driver_w9: [{ profile_id: RIDER, legal_name: 'Riley Rider', address_line: '1 Campus Dr', business_name: 'RR', signature_name: 'Riley', tin_ciphertext: 'cipher' }],
    driver_mileage_logs: [{ driver_id: RIDER, pickup_label: 'Library', dropoff_label: 'Airport' }],
    driver_payouts: [{ driver_id: RIDER, amount_cents: 4000 }],
  })
  const stripe = stripeMock()
  await deleteAccount(sb, user(RIDER), { stripe, env: {}, warn() {} })
  const profile = sb.tables.profiles[0]
  assert.equal(profile.full_name, DELETED_NAME)
  assert.equal(profile.email, deletedEmail(RIDER))
  assert.equal(profile.phone, null)
  assert.equal(profile.expo_push_token, null)
  assert.equal(profile.stripe_customer_id, 'cus_r')
  assert.equal(profile.stripe_default_pm_id, null)
  assert.deepEqual(profile.favorite_spots, [])
  assert.equal(sb.tables.rider_push_tokens.length, 0)
  assert.equal(sb.tables.saved_places.length, 0)
  assert.equal(sb.tables.trip_messages[0].body, 'Removed')
  assert.equal(sb.tables.trips[0].status, 'completed')
  assert.equal(sb.tables.driver_w9[0].legal_name, 'Riley Rider')
  assert.equal(sb.tables.driver_w9[0].tin_ciphertext, 'cipher')
  assert.equal(sb.tables.driver_w9[0].address_line, 'Retained for tax records')
  assert.equal(sb.tables.driver_w9[0].signature_name, null)
  assert.equal(sb.tables.driver_mileage_logs[0].pickup_label, null)
  assert.equal(sb.tables.driver_payouts[0].amount_cents, 4000)
  assert.equal(stripe.customerUpdates[0].id, 'cus_r')
  assert.equal(stripe.customerUpdates[0].patch.name, DELETED_NAME)
})

test('deleting an auth user that is already gone is success', async () => {
  const sb = memoryDb({ trips: [], profiles: [{ id: RIDER, full_name: 'Riley', email: 'riley@clemson.edu' }] }, {
    deleteUser: async () => ({ error: { message: 'User not found', status: 404, code: 'user_not_found' } }),
  })
  const result = await deleteAccount(sb, user(RIDER), { env: {}, warn() {} })
  assert.equal(result.ok, true)
  assert.equal(result.idempotent, true)
})

test('a guest session is not an account deletion', async () => {
  const sb = memoryDb()
  const result = await deleteAccount(sb, user(RIDER, { is_anonymous: true }), { env: {}, warn() {} })
  assert.equal(result.blocked, true)
  assert.equal(result.status, 403)
  assert.equal(result.error, GUEST_DELETE_ERROR)
  assert.equal(sb.calls.some((call) => call.op === 'deleteUser'), false)
})

test('an open hold or live subscription that cannot be released stops before the auth user is deleted', async () => {
  const held = memoryDb({
    trips: [{
      id: 'trip-hold',
      status: 'searching',
      rider_id: RIDER,
      driver_id: null,
      fare_cents: 1200,
      metadata: { fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_open' } },
    }],
    profiles: [{ id: RIDER, full_name: 'Riley', email: 'riley@clemson.edu' }],
  })
  await assert.rejects(
    () => deleteAccount(held, user(RIDER), { stripe: null, env: {}, warn() {} }),
    (error) => error.status === 409 && error.message === HOLD_RELEASE_ERROR,
  )
  assert.equal(held.calls.some((call) => call.op === 'deleteUser'), false)
  assert.equal(held.tables.trips[0].status, 'searching')

  const sub = memoryDb({
    trips: [],
    profiles: [{ id: RIDER, full_name: 'Riley', email: 'riley@clemson.edu' }],
    rider_subscriptions: [{ rider_id: RIDER, status: 'active', stripe_subscription_id: 'sub_live' }],
    student_plan_subscriptions: [],
  })
  await assert.rejects(
    () => deleteAccount(sub, user(RIDER), { stripe: null, env: {}, warn() {} }),
    (error) => error.status === 409 && error.message === SUBSCRIPTION_CANCEL_ERROR,
  )
  assert.equal(sub.calls.some((call) => call.op === 'deleteUser'), false)
})

test('an Apple sign-in still deletes when the Apple key is missing, and warns', async () => {
  const warnings = []
  const sb = memoryDb({
    trips: [],
    profiles: [{ id: RIDER, full_name: 'Riley', email: 'riley@clemson.edu' }],
  })
  const result = await deleteAccount(sb, user(RIDER, {
    app_metadata: { provider: 'apple' },
    identities: [{ provider: 'apple', identity_data: { refresh_token: 'refresh-1' } }],
  }), { env: {}, warn: (message) => warnings.push(message) })
  assert.equal(result.ok, true)
  assert.equal(result.apple.reason, 'apple_not_configured')
  assert.equal(warnings.includes(APPLE_NOT_CONFIGURED_WARNING), true)
  assert.equal(sb.calls.some((call) => call.op === 'deleteUser'), true)
})

test('POST /api/account?action=delete requires DELETE and returns the in-progress error', async () => {
  const missing = await invoke({ body: {} }, { sb: memoryDb(), user: user(RIDER), stripe: null, env: {} })
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /Type DELETE/)

  const wrong = await invoke({ method: 'GET', body: { confirm: 'DELETE' } }, { sb: memoryDb(), user: user(RIDER), stripe: null })
  assert.equal(wrong.status, 405)

  const signedOut = await invoke({ body: { confirm: 'DELETE' } }, { sb: memoryDb(), user: null, stripe: null })
  assert.equal(signedOut.status, 401)

  const down = await invoke({ body: { confirm: 'DELETE' } }, { sb: null, user: user(RIDER), stripe: null })
  assert.equal(down.status, 503)
  assert.doesNotMatch(down.body.error, /not configured|STRIPE_|SUPABASE_/)

  const sb = memoryDb({
    trips: [{ id: 'trip-live', status: 'in_progress', rider_id: RIDER, driver_id: DRIVER, metadata: {}, fare_cents: 1800 }],
    profiles: [{ id: DRIVER, full_name: 'Dana', email: 'dana@clemson.edu' }],
  })
  const blocked = await invoke({ body: { confirm: 'DELETE' } }, {
    sb,
    user: user(DRIVER),
    stripe: stripeMock(),
    env: {},
    warn() {},
  })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.error, TRIP_IN_PROGRESS_ERROR)
  assert.equal(blocked.body.code, 'trip_in_progress')
})

test('the tax-row migration drops the profiles auth cascade and does not drop financial tables', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261016170000_account_deletion_keep_tax_rows.sql', import.meta.url), 'utf8')
  assert.match(sql, /alter table public\.profiles drop constraint/)
  assert.match(sql, /f\.relname = 'users'/)
  assert.match(sql, /fn\.nspname = 'auth'/)
  assert.doesNotMatch(sql, /drop table/i)
  assert.doesNotMatch(sql, /delete from/i)
})
