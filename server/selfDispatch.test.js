import test from 'node:test'
import assert from 'node:assert/strict'
import handler from './endpoints/requestDriverTrip.js'
import { listAssignableDrivers } from './autoAssign.js'
import { filterDriversForFleet } from '../packages/rides-native/drivers.js'

test('request rejects own driver before any database query or trip insert', async () => {
  const res = { setHeader() {}, end(value) { this.body = JSON.parse(value) } }
  await handler({ method: 'POST', body: { driverId: ' owner ' } }, res, {
    user: { id: 'owner' }, sb: { from() { assert.fail('database accessed') } },
  })
  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, { code: 'own_driver_account', error: "That's your own driver account. Pick another driver, or sign in to a separate rider account to test." })
})

test('auto assignment excludes rider even with highest rank and preference', async () => {
  const tables = {
    driver_status: [{ driver_id: 'owner', online: true }, { driver_id: 'other', online: true }],
    driver_applications: [{ profile_id: 'owner', onboarding_status: 'approved' }, { profile_id: 'other', onboarding_status: 'approved' }],
    profiles: [{ id: 'owner', email: 'john@example.com' }, { id: 'other', email: 'other@example.com' }],
  }
  const sb = { from(table) {
    let filtered = tables[table] || []
    const q = { select() { return q }, eq(col, val) { filtered = filtered.filter(row => row[col] === val); return q }, in(col, ids) { filtered = filtered.filter(row => ids.includes(row[col])); return q }, async maybeSingle() { return { data: filtered[0], error: null } }, then(resolve) { resolve({ data: filtered, error: null }) } }
    return q
  } }
  const result = await listAssignableDrivers(sb, { riderId: 'owner', preferredIds: ['owner'], favoriteIds: ['owner'] })
  assert.equal(result.error, null)
  assert.deepEqual(result.drivers.map(row => row.id), ['other'])
  tables.driver_status.pop()
  assert.deepEqual((await listAssignableDrivers(sb, { riderId: 'owner' })).drivers, [])
})

test('shared picker filters viewer while retaining existing callers', () => {
  const rows = [{ id: 'owner' }, { id: 'other' }]
  assert.deepEqual(filterDriversForFleet(rows, 'standard', 'owner'), [{ id: 'other' }])
  assert.deepEqual(filterDriversForFleet(rows), rows)
})
