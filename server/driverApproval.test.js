import assert from 'node:assert/strict'
import test from 'node:test'
import { canReceiveRides, driverApprovalStatus, receivableDriverIds } from './driverApproval.js'
import { ONBOARDING_STATUSES } from '../shared/driverOnboarding.js'
import { approvalGateMessage } from '../packages/rides-native/syntheticOffers.js'
import requestDriverTrip from './endpoints/requestDriverTrip.js'
import tripOfferPreview from './endpoints/tripOfferPreview.js'
import { createGroupRide } from './carpoolService.js'

function fakeApplicationsSb({ data = null, error = null } = {}) {
  const calls = []
  return {
    calls,
    sb: {
      from(table) {
        calls.push({ op: 'from', table })
        return {
          select(columns) {
            calls.push({ op: 'select', columns })
            return {
              eq(col, val) {
                calls.push({ op: 'eq', col, val })
                return {
                  async maybeSingle() {
                    calls.push({ op: 'maybeSingle' })
                    return { data, error }
                  },
                }
              },
            }
          },
        }
      },
    },
  }
}

test('canReceiveRides is true only for approved among every ONBOARDING_STATUSES value', () => {
  assert.ok(ONBOARDING_STATUSES.includes('approved'))
  for (const status of ONBOARDING_STATUSES) {
    assert.equal(canReceiveRides(status), status === 'approved', String(status))
  }
})

test('canReceiveRides is false for null, undefined, and garbage', () => {
  assert.equal(canReceiveRides(null), false)
  assert.equal(canReceiveRides(undefined), false)
  const garbage = [
    '',
    'pending',
    'none',
    'Under review',
    'APPROVED',
    'approved ',
    0,
    1,
    false,
    true,
    {},
    [],
  ]
  for (const status of garbage) {
    assert.equal(canReceiveRides(status), false, String(status))
  }
})

test('driverApprovalStatus: approved application is approved', async () => {
  const profileId = 'driver-approved'
  const { sb, calls } = fakeApplicationsSb({
    data: { onboarding_status: 'approved' },
  })
  const gate = await driverApprovalStatus(sb, profileId)
  assert.deepEqual(gate, { approved: true, status: 'approved', error: null })
  assert.equal(calls.find((c) => c.op === 'from')?.table, 'driver_applications')
  assert.equal(calls.find((c) => c.op === 'select')?.columns, 'onboarding_status')
  assert.deepEqual(calls.find((c) => c.op === 'eq'), {
    op: 'eq',
    col: 'profile_id',
    val: profileId,
  })
})

test('driverApprovalStatus: pending_review is not approved', async () => {
  const { sb } = fakeApplicationsSb({
    data: { onboarding_status: 'pending_review' },
  })
  const gate = await driverApprovalStatus(sb, 'driver-pending')
  assert.deepEqual(gate, { approved: false, status: 'pending_review', error: null })
})

test('driverApprovalStatus: missing row is not approved', async () => {
  const { sb } = fakeApplicationsSb({ data: null, error: null })
  const gate = await driverApprovalStatus(sb, 'driver-missing')
  assert.deepEqual(gate, { approved: false, status: null, error: null })
})

test('driverApprovalStatus: db error is not approved', async () => {
  const { sb } = fakeApplicationsSb({
    data: { onboarding_status: 'approved' },
    error: { message: 'schema cache miss' },
  })
  const gate = await driverApprovalStatus(sb, 'driver-error')
  assert.deepEqual(gate, { approved: false, status: null, error: 'schema cache miss' })
})

function memorySb(seed = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row }))
  }
  const calls = []
  function rowsOf(table) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }
  function from(table) {
    calls.push({ op: 'from', table })
    const state = { filters: [], op: 'select', payload: null }
    const api = {
      select() {
        calls.push({ op: 'select', table })
        return api
      },
      eq(col, val) {
        state.filters.push({ col, val, kind: 'eq' })
        calls.push({ op: 'eq', table, col, val })
        return api
      },
      in(col, val) {
        state.filters.push({ col, val, kind: 'in' })
        calls.push({ op: 'in', table, col, val })
        return api
      },
      lte() { return api },
      gte() { return api },
      gt() { return api },
      order() { return api },
      limit() { return api },
      is() { return api },
      not() { return api },
      match(row) {
        return state.filters.every((filter) => {
          if (filter.kind === 'in') return filter.val.includes(row[filter.col])
          return row[filter.col] === filter.val
        })
      },
      async maybeSingle() {
        const found = rowsOf(table).filter((row) => api.match(row))
        return { data: found[0] || null, error: null }
      },
      async single() {
        if (state.op === 'insert') {
          const row = { id: state.payload.id || `${table}-${rowsOf(table).length + 1}`, ...state.payload }
          rowsOf(table).push(row)
          calls.push({ op: 'insert', table, payload: state.payload })
          return { data: row, error: null }
        }
        const found = rowsOf(table).filter((row) => api.match(row))
        return { data: found[0] || null, error: found[0] ? null : { message: 'missing' } }
      },
      insert(payload) {
        state.op = 'insert'
        state.payload = payload
        return api
      },
      upsert(payload) {
        calls.push({ op: 'upsert', table, payload })
        return Promise.resolve({ data: null, error: null })
      },
      update() {
        return api
      },
      then(resolve) {
        if (state.op === 'insert') {
          const row = { id: state.payload.id || `${table}-${rowsOf(table).length + 1}`, ...state.payload }
          rowsOf(table).push(row)
          calls.push({ op: 'insert', table, payload: state.payload })
          resolve({ data: null, error: null })
          return
        }
        resolve({ data: rowsOf(table).filter((row) => api.match(row)), error: null })
      },
    }
    return api
  }
  return { sb: { from }, calls, tables }
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function callHandler(handler, req, deps) {
  const res = mockRes()
  await handler({ headers: {}, method: 'POST', ...req }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

const REQUEST_BODY = {
  pickupLabel: 'Clemson Campus',
  pickupLat: 34.6788,
  pickupLng: -82.843,
  dropoffLabel: 'Downtown',
  destLat: 34.68,
  destLng: -82.83,
}

test('receivableDriverIds batches one application read and skips pending_review', async () => {
  const pending = 'driver-pending'
  const approved = 'driver-approved'
  const { sb, calls } = memorySb({
    driver_applications: [
      { profile_id: pending, onboarding_status: 'pending_review' },
      { profile_id: approved, onboarding_status: 'approved' },
    ],
    profiles: [{ id: pending, role: 'driver' }],
  })
  const gate = await receivableDriverIds(sb, [pending, approved, pending])
  assert.equal(gate.error, null)
  assert.equal(gate.allowed.size, 1)
  assert.equal(gate.allowed.has(approved), true)
  assert.equal(gate.allowed.has(pending), false)
  const reads = calls.filter((call) => call.op === 'in' && call.table === 'driver_applications')
  assert.equal(reads.length, 1)
  assert.deepEqual(reads[0].val, [pending, approved])
})

test('receivableDriverIds lets staff through without an approved application', async () => {
  const staffId = 'staff-driver'
  const supportId = 'support-driver'
  const { sb } = memorySb({
    driver_applications: [
      { profile_id: staffId, onboarding_status: 'pending_review' },
      { profile_id: supportId, onboarding_status: 'rejected' },
    ],
    profiles: [
      { id: staffId, email: 'ops@clemson.edu', role: 'admin', is_admin: true },
      { id: supportId, email: 'desk@clemson.edu', role: 'rider', is_admin: false },
    ],
    admin_users: [{ email: 'desk@clemson.edu', access_role: 'support' }],
  })
  const gate = await receivableDriverIds(sb, [staffId, supportId])
  assert.equal(gate.error, null)
  assert.equal(gate.allowed.has(staffId), true)
  assert.equal(gate.allowed.has(supportId), true)
})

test('driverApprovalStatus treats an admin with pending_review as allowed', async () => {
  const { sb } = memorySb({
    driver_applications: [{ profile_id: 'admin-1', onboarding_status: 'pending_review' }],
    profiles: [{ id: 'admin-1', email: 'ops@clemson.edu', role: 'admin' }],
  })
  const gate = await driverApprovalStatus(sb, 'admin-1')
  assert.equal(gate.approved, true)
  assert.equal(gate.status, 'pending_review')
  assert.equal(gate.error, null)
})

test('receivableDriverIds returns no one when the application read fails', async () => {
  const sb = {
    from() {
      return {
        select() {
          return {
            in() {
              return Promise.resolve({ data: null, error: { message: 'schema cache miss' } })
            },
          }
        },
      }
    },
  }
  const gate = await receivableDriverIds(sb, ['driver-a', 'driver-b'])
  assert.equal(gate.allowed.size, 0)
  assert.equal(gate.error, 'schema cache miss')
})

test('requestDriverTrip skips a pending_review driver and still assigns an approved driver', async () => {
  const pendingSb = memorySb({
    driver_applications: [{ profile_id: 'driver-pending', onboarding_status: 'pending_review' }],
    profiles: [{ id: 'driver-pending', role: 'driver' }],
  })
  const denied = await callHandler(requestDriverTrip, {
    body: { ...REQUEST_BODY, driverId: 'driver-pending' },
  }, {
    sb: pendingSb.sb,
    user: { id: 'rider-1', email: 'rider@clemson.edu', user_metadata: { full_name: 'Test Rider' } },
    ensureProfile: async () => { throw new Error('ensureProfile should not run') },
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.json.code, 'driver_not_approved')
  assert.equal(pendingSb.tables.trips?.length || 0, 0)

  const approvedSb = memorySb({
    driver_applications: [{ profile_id: 'driver-approved', onboarding_status: 'approved' }],
  })
  const allowed = await callHandler(requestDriverTrip, {
    body: { ...REQUEST_BODY, driverId: 'driver-approved' },
  }, {
    sb: approvedSb.sb,
    user: { id: 'rider-1', email: 'rider@clemson.edu', user_metadata: { full_name: 'Test Rider' } },
    ensureProfile: async () => ({ ok: true }),
  })
  assert.equal(allowed.status, 200)
  assert.equal(approvedSb.tables.trips.length, 1)
  assert.equal(approvedSb.tables.trips[0].driver_id, 'driver-approved')
})

test('trip offer preview hides open trips from pending_review and still previews an accepted trip', async () => {
  const user = { id: 'driver-1' }
  const pending = memorySb({
    driver_status: [{ driver_id: 'driver-1' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'pending_review' }],
    profiles: [
      { id: 'driver-1', role: 'driver' },
      { id: 'rider-1', full_name: 'Ava Student' },
    ],
    trips: [{ id: 'trip-open', rider_id: 'rider-1', driver_id: null, status: 'searching' }],
  })
  const hidden = await callHandler(tripOfferPreview, {
    body: { tripId: 'trip-open' },
  }, { sb: pending.sb, user })
  assert.equal(hidden.status, 403)
  assert.equal(hidden.json.code, 'driver_not_approved')
  assert.equal(hidden.json.error, approvalGateMessage())

  const approved = memorySb({
    driver_status: [{ driver_id: 'driver-1' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'approved' }],
    profiles: [{ id: 'rider-1', full_name: 'Ava Student' }],
    trips: [{ id: 'trip-open', rider_id: 'rider-1', driver_id: null, status: 'searching' }],
  })
  const shown = await callHandler(tripOfferPreview, {
    body: { tripId: 'trip-open' },
  }, { sb: approved.sb, user })
  assert.equal(shown.status, 200)
  assert.equal(shown.json.riderFirstName, 'Ava')

  const live = memorySb({
    driver_status: [{ driver_id: 'driver-1' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'pending_review' }],
    profiles: [
      { id: 'driver-1', role: 'driver' },
      { id: 'rider-1', full_name: 'Ava Student' },
    ],
    trips: [{ id: 'trip-live', rider_id: 'rider-1', driver_id: 'driver-1', status: 'in_progress' }],
  })
  const kept = await callHandler(tripOfferPreview, {
    body: { tripId: 'trip-live' },
  }, { sb: live.sb, user })
  assert.equal(kept.status, 200)
  assert.equal(kept.json.riderFirstName, 'Ava')
})

test('createGroupRide does not assign a pending_review driver and does assign an approved driver', async () => {
  const place = {
    pickup: { label: 'Tillman Hall', lat: 34.68, lng: -82.84 },
    dropoff: { label: 'The Pier', lat: 34.67, lng: -82.82 },
  }
  const pending = memorySb({
    driver_applications: [{ profile_id: 'driver-pending', onboarding_status: 'pending_review' }],
    profiles: [{ id: 'driver-pending', role: 'driver' }],
  })
  const denied = await createGroupRide(pending.sb, {
    user: { id: 'driver-pending', email: 'pat@clemson.edu' },
    ...place,
    driving: true,
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'driver_not_approved')
  assert.equal(pending.tables.friend_rides?.length || 0, 0)

  const approved = memorySb({
    driver_applications: [{ profile_id: 'driver-approved', onboarding_status: 'approved' }],
  })
  const created = await createGroupRide(approved.sb, {
    user: { id: 'driver-approved', email: 'amy@clemson.edu' },
    ...place,
    driving: true,
  })
  assert.equal(created.ok, undefined)
  assert.ok(created.rideId)
  assert.equal(approved.tables.friend_rides[0].driver_profile_id, 'driver-approved')
})
