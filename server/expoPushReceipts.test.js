import assert from 'node:assert/strict'
import test from 'node:test'
import { forgetExpoPushToken, recordExpoPushTicket, sweepExpoPushReceipts } from './expoPushReceipts.js'

function memory(seed = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))
  function rowsOf(table) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }
  function from(table) {
    const state = { filters: [], op: 'select', payload: null }
    const api = {
      select() { return api },
      is(col, val) { state.filters.push({ col, val, op: 'is' }); return api },
      eq(col, val) { state.filters.push({ col, val, op: 'eq' }); return api },
      limit() { return api },
      match(row) {
        return state.filters.every((filter) => (filter.op === 'is' ? (row[filter.col] ?? null) === filter.val : row[filter.col] === filter.val))
      },
      delete() { state.op = 'delete'; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      then(resolve) {
        const rows = rowsOf(table).filter((row) => api.match(row))
        if (state.op === 'delete') tables[table] = rowsOf(table).filter((row) => !api.match(row))
        if (state.op === 'update') rows.forEach((row) => Object.assign(row, state.payload))
        if (state.op === 'insert') rowsOf(table).push({ ...state.payload })
        resolve({ data: rows.map((row) => ({ ...row })), error: null })
      },
    }
    return api
  }
  return { sb: { from }, tables }
}

const NOW = new Date('2026-10-13T21:00:00.000Z')

test('a missing receipt table does not fail the sweep', async () => {
  const sb = {
    from() {
      return {
        select() { return this },
        is() { return this },
        limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "public.expo_push_tickets" does not exist' } }),
      }
    },
  }
  const result = await sweepExpoPushReceipts(sb, { now: NOW, fetchReceipts: async () => assert.fail('no fetch') })
  assert.equal(result.unavailable, true)
  assert.equal(result.dropped, 0)
})

test('dry run does not read tickets', async () => {
  const result = await sweepExpoPushReceipts({ from() { throw new Error('db') } }, { dryRun: true })
  assert.deepEqual(result, { checked: 0, dropped: 0, pending: 0 })
})

test('DeviceNotRegistered receipt drops that token and keeps a newer one', async () => {
  const db = memory({
    expo_push_tickets: [
      { ticket_id: 'old', token: 'ExponentPushToken[old]', owner_id: 'driver-1', owner_role: 'driver', created_at: '2026-10-13T20:00:00.000Z', checked_at: null },
      { ticket_id: 'fresh', token: 'ExponentPushToken[fresh]', owner_id: 'rider-1', owner_role: 'rider', created_at: '2026-10-13T20:59:55.000Z', checked_at: null },
    ],
    driver_push_tokens: [
      { driver_id: 'driver-1', token: 'ExponentPushToken[old]' },
      { driver_id: 'driver-2', token: 'ExponentPushToken[other]' },
    ],
    driver_status: [{ driver_id: 'driver-1', expo_push_token: 'ExponentPushToken[old]' }],
    rider_push_tokens: [{ rider_id: 'rider-1', token: 'ExponentPushToken[fresh]' }],
  })
  const result = await sweepExpoPushReceipts(db.sb, {
    now: NOW,
    fetchReceipts: async (ids) => {
      assert.deepEqual(ids, ['old'])
      return { ok: true, receipts: { old: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }
    },
  })
  assert.equal(result.checked, 1)
  assert.equal(result.dropped, 1)
  assert.equal(result.pending, 1)
  assert.deepEqual(db.tables.driver_push_tokens.map((row) => row.token), ['ExponentPushToken[other]'])
  assert.equal(db.tables.driver_status[0].expo_push_token, null)
  assert.equal(db.tables.rider_push_tokens.length, 1)
  assert.equal(db.tables.expo_push_tickets.find((row) => row.ticket_id === 'old').receipt_error, 'DeviceNotRegistered')
  assert.equal(db.tables.expo_push_tickets.find((row) => row.ticket_id === 'fresh').checked_at, null)
})

test('an ok receipt is checked and does not drop the token', async () => {
  const db = memory({
    expo_push_tickets: [
      { ticket_id: 'ok-1', token: 'ExponentPushToken[keep]', owner_id: 'rider-1', owner_role: 'rider', created_at: '2026-10-13T20:00:00.000Z', checked_at: null },
    ],
    rider_push_tokens: [{ rider_id: 'rider-1', token: 'ExponentPushToken[keep]' }],
  })
  const result = await sweepExpoPushReceipts(db.sb, {
    now: NOW,
    fetchReceipts: async () => ({ ok: true, receipts: { 'ok-1': { status: 'ok' } } }),
  })
  assert.equal(result.dropped, 0)
  assert.equal(result.checked, 1)
  assert.equal(db.tables.rider_push_tokens.length, 1)
})

test('recording a ticket is a no-op when the table is missing', async () => {
  const sb = { from() { return { insert: async () => ({ error: { code: 'PGRST205', message: 'expo_push_tickets schema cache' } }) } } }
  const result = await recordExpoPushTicket(sb, { ticketId: 't1', token: 'ExponentPushToken[a]', ownerId: 'u', ownerRole: 'rider' })
  assert.equal(result.unavailable, true)
  assert.equal(result.stored, false)
})

test('forget removes only the matching rider token', async () => {
  const db = memory({
    rider_push_tokens: [
      { rider_id: 'rider-1', token: 'ExponentPushToken[gone]' },
      { rider_id: 'rider-1', token: 'ExponentPushToken[stay]' },
    ],
  })
  await forgetExpoPushToken(db.sb, { token: 'ExponentPushToken[gone]', ownerId: 'rider-1', ownerRole: 'rider' })
  assert.deepEqual(db.tables.rider_push_tokens.map((row) => row.token), ['ExponentPushToken[stay]'])
})
