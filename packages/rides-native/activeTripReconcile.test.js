import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileActiveTrip, tripTerminalClearReason } from './activeTripReconcile.js'
import { bindRealtimeChannel, REALTIME_DROP_STATUSES } from './realtimeReconnect.js'

const local = { id: 'trip-1', status: 'in_progress' }

test('reconcile keeps an active trip when the rider app is gone but the server row is still live', () => {
  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress']) {
    const server = { id: 'trip-1', status, metadata: {} }
    assert.equal(tripTerminalClearReason(server), null)
    assert.deepEqual(reconcileActiveTrip(local, server), { action: 'keep', reason: null, trip: server })
  }
})

test('reconcile clears cancelled, completed, and expired server rows', () => {
  const cases = [
    ['canceled', 'cancelled'],
    ['cancelled', 'cancelled'],
    ['canceled_midride', 'cancelled'],
    ['cancelled_wait', 'cancelled'],
    ['completed', 'completed'],
    ['expired', 'expired'],
  ]
  for (const [status, reason] of cases) {
    const server = { id: 'trip-1', status }
    assert.equal(tripTerminalClearReason(server), reason)
    assert.deepEqual(reconcileActiveTrip({ id: 'trip-1', status: 'accepted' }, server), {
      action: 'clear',
      reason,
      trip: server,
    })
  }
  const flagged = { id: 'trip-1', status: 'in_progress', metadata: { expired: true } }
  assert.equal(reconcileActiveTrip(local, flagged).reason, 'expired')
  const abandoned = { id: 'trip-1', status: 'canceled', metadata: { cancel_reason: 'stale_abandoned', stale_abandoned: true } }
  assert.equal(reconcileActiveTrip(local, abandoned).reason, 'cancelled')
})

test('reconcile clears a trip the server no longer has, and ignores an empty local card', () => {
  assert.deepEqual(reconcileActiveTrip(local, null), { action: 'clear', reason: 'expired', trip: null })
  assert.equal(reconcileActiveTrip(local, { id: 'other', status: 'in_progress' }).action, 'clear')
  assert.deepEqual(reconcileActiveTrip(null, local), { action: 'none', reason: null, trip: null })
  assert.deepEqual(reconcileActiveTrip({}, { id: 'trip-1', status: 'canceled' }), { action: 'none', reason: null, trip: null })
})

test('a dropped realtime channel asks for a refetch and subscribes again', async () => {
  const events = []
  let subscribes = 0
  const channels = []
  const supabase = {
    channel(name) {
      const handlers = []
      const ch = {
        name,
        on(_event, _filter, callback) {
          handlers.push(callback)
          return ch
        },
        subscribe(onStatus) {
          subscribes += 1
          channels.push({ name, onStatus, emit: (payload) => handlers.forEach((fn) => fn(payload)) })
          return ch
        },
      }
      return ch
    },
    removeChannel(ch) {
      const index = channels.findIndex((item) => item.name === ch?.name)
      if (index !== -1) channels.splice(index, 1)
    },
  }
  const stop = bindRealtimeChannel(supabase, {
    topic: () => `driver-trips-${subscribes}`,
    onChange: (payload) => events.push(payload),
    resubscribeMs: 0,
  })
  assert.equal(subscribes, 1)
  channels[0].emit({ new: { id: 'trip-1', status: 'accepted' } })
  assert.equal(events.length, 1)
  for (const status of REALTIME_DROP_STATUSES) {
    const before = subscribes
    channels[0].onStatus(status)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(subscribes, before + 1, status)
    assert.equal(events.at(-1).eventType, 'RECONNECT')
  }
  const open = channels[0]
  open.onStatus('SUBSCRIBED')
  assert.equal(events.at(-1).eventType, 'RECONNECT')
  const count = subscribes
  stop()
  open.onStatus('CLOSED')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(subscribes, count)
})
