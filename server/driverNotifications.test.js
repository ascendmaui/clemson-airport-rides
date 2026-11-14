import assert from 'node:assert/strict'
import test from 'node:test'
import { insertDriverNotification } from './driverNotifications.js'

function memorySb() {
  const tables = {}
  return {
    tables,
    from(table) {
      if (!tables[table]) tables[table] = []
      const state = { op: 'select', payload: null, filters: [] }
      const api = {
        select() { return api },
        eq(col, val) { state.filters.push([col, val]); return api },
        insert(payload) { state.op = 'insert'; state.payload = payload; return api },
        then(resolve) {
          if (state.op === 'insert') {
            tables[table].push({ ...state.payload })
            resolve({ data: { ...state.payload }, error: null })
            return
          }
          const data = tables[table].filter((row) => state.filters.every(([col, val]) => row[col] === val))
          resolve({ data, error: null })
        },
      }
      return api
    },
  }
}

test('an inbox insert records the driver and does not throw when the table is missing', async () => {
  const sb = memorySb()
  const saved = await insertDriverNotification(sb, {
    userId: 'driver-1',
    type: 'ride_offer',
    title: 'New ride request',
    body: 'Library → Stadium',
    data: { tripId: 'trip-1', kind: 'ride_offer' },
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.reason, 'inserted')
  assert.equal(sb.tables.driver_notifications.length, 1)
  assert.equal(sb.tables.driver_notifications[0].user_id, 'driver-1')
  assert.equal(sb.tables.driver_notifications[0].type, 'ride_offer')
  assert.equal(sb.tables.driver_notifications[0].data.tripId, 'trip-1')

  const missing = await insertDriverNotification({
    from() {
      return { select() { return this }, eq() { return this } }
    },
  }, { userId: 'driver-1', type: 'ride_offer', title: 'New ride request', body: 'A → B' })
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'insert_unavailable')

  const thrown = await insertDriverNotification({
    from() { throw new Error('relation driver_notifications does not exist') },
  }, { userId: 'driver-1', type: 'ride_offer', title: 'New ride request', body: 'A → B' })
  assert.equal(thrown.reason, 'notifications_unavailable')
})
