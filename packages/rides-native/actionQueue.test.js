import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createActionQueue, isOfflineError, isQueueableAction, projectTripStatus, retryDelayMs, waitingForSignalLabel, newIdempotencyKey,
} from './actionQueue.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return { data, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => { data[k] = v }, removeItem: async (k) => { delete data[k] } }
}
const offlineErr = () => Object.assign(new Error('Network request failed'), { network: true })

function manualTimers() {
  const timers = []
  return { timers, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } }
}

test('offline detection and backoff', () => {
  assert.equal(isOfflineError(offlineErr()), true)
  assert.equal(isOfflineError({ name: 'AbortError' }), true)
  assert.equal(isOfflineError({ status: 503 }), true)
  assert.equal(isOfflineError({ status: 409, message: 'invalid_transition' }), false)
  assert.equal(isOfflineError(null), false)
  assert.equal(retryDelayMs(1), 2000)
  assert.equal(retryDelayMs(99), 30000)
  assert.match(newIdempotencyKey(1, () => 0.5), /^drv-[a-z0-9]+-[a-z0-9]+$/)
  assert.match(newIdempotencyKey(), /^[A-Za-z0-9:_.-]{8,128}$/)
})

test('only status advances and stop taps are queueable', () => {
  assert.equal(isQueueableAction({ kind: 'status', tripId: 't', op: 'arrive' }), true)
  assert.equal(isQueueableAction({ kind: 'status', tripId: 't', op: 'accept' }), false)
  assert.equal(isQueueableAction({ kind: 'status', tripId: 't', op: 'driver-cancel' }), false)
  assert.equal(isQueueableAction({ kind: 'status', tripId: 't', op: 'cancel' }), false)
  assert.equal(isQueueableAction({ kind: 'stop', tripId: 't', op: 'drop', stopIndex: 2 }), true)
  assert.equal(isQueueableAction({ kind: 'stop', tripId: 't', op: 'drop' }), false)
})

test('projected status and banner copy', () => {
  const q = [{ tripId: 't', kind: 'status', op: 'arrive' }, { tripId: 't', kind: 'status', op: 'start' }, { tripId: 'x', kind: 'status', op: 'complete' }]
  assert.equal(projectTripStatus('arriving', q, 't'), 'in_progress')
  assert.equal(projectTripStatus('arriving', [], 't'), 'arriving')
  assert.equal(waitingForSignalLabel(0), null)
  assert.equal(waitingForSignalLabel(1), 'Waiting for signal · 1 tap saved')
  assert.equal(waitingForSignalLabel(3), 'Waiting for signal · 3 taps saved')
})

test('online taps send right away with an idempotency key', async () => {
  const sent = []
  const queue = createActionQueue({ send: async (a) => { sent.push(a); return { ok: true, op: a.op } } })
  const out = await queue.submit({ kind: 'status', tripId: 't1', op: 'arrive' })
  assert.equal(out.status, 'sent')
  assert.equal(out.result.op, 'arrive')
  assert.equal(sent.length, 1)
  assert.match(sent[0].id, /^drv-/)
  assert.equal(queue.state().pending, 0)
})

test('offline taps queue in order, persist, and retry with the same keys', async () => {
  const storage = memoryStorage()
  const timers = manualTimers()
  let online = false
  const sent = []
  const queue = createActionQueue({ storage, ...timers, send: async (a) => { if (!online) throw offlineErr(); sent.push(a); return { ok: true } } })
  const a = await queue.submit({ kind: 'status', tripId: 't1', op: 'arrive' })
  const b = await queue.submit({ kind: 'status', tripId: 't1', op: 'start' })
  assert.equal(a.status, 'queued')
  assert.equal(b.status, 'queued')
  assert.equal(queue.state().offline, true)
  assert.equal(queue.state().pending, 2)
  const saved = JSON.parse(storage.data['driver-action-queue.v1'])
  assert.deepEqual(saved.map((x) => x.op), ['arrive', 'start'])
  const keys = saved.map((x) => x.id)
  assert.ok(timers.timers.length >= 1)

  online = true
  await queue.flush()
  assert.deepEqual(sent.map((x) => x.op), ['arrive', 'start'])
  assert.deepEqual(sent.map((x) => x.id), keys)
  assert.equal(queue.state().pending, 0)
  assert.equal(queue.state().offline, false)
  assert.equal(storage.data['driver-action-queue.v1'], undefined)
})

test('a saved queue survives restart and flushes', async () => {
  const storage = memoryStorage({ 'driver-action-queue.v1': JSON.stringify([
    { id: 'drv-saved-0001', kind: 'status', tripId: 't1', op: 'arrive', attempts: 2 },
    { id: 'bad' },
  ]) })
  const sent = []
  const queue = createActionQueue({ storage, send: async (a) => { sent.push(a.id); return {} } })
  await queue.flush()
  assert.deepEqual(sent, ['drv-saved-0001'])
})

test('a rejected tap drops the dependent taps for that trip only', async () => {
  const timers = manualTimers()
  let online = false
  const events = []
  const queue = createActionQueue({
    ...timers,
    onEvent: (e) => events.push(e),
    send: async (a) => {
      if (!online) throw offlineErr()
      if (a.tripId === 't1' && a.op === 'arrive') throw Object.assign(new Error('Trip was canceled'), { status: 409, code: 'invalid_transition' })
      return { ok: true }
    },
  })
  await queue.submit({ kind: 'status', tripId: 't1', op: 'arrive' })
  await queue.submit({ kind: 'status', tripId: 't2', op: 'arrive' })
  await queue.submit({ kind: 'status', tripId: 't1', op: 'start' })
  online = true
  await queue.flush()
  assert.equal(queue.state().pending, 0)
  const failed = events.find((e) => e.type === 'failed')
  assert.equal(failed.action.op, 'arrive')
  assert.deepEqual(failed.dropped.map((a) => a.op), ['arrive', 'start'])
  assert.deepEqual(events.filter((e) => e.type === 'sent').map((e) => e.action.tripId), ['t2'])
  assert.equal(queue.state().lastError.code, 'invalid_transition')
})

test('non-queueable actions are refused', async () => {
  const queue = createActionQueue({ send: async () => ({}) })
  await assert.rejects(() => queue.submit({ kind: 'status', tripId: 't', op: 'accept' }), /cannot be queued/)
})

test('the storage key is valid for Expo SecureStore', async () => {
  const { QUEUE_STORAGE_KEY } = await import('./actionQueue.js')
  assert.match(QUEUE_STORAGE_KEY, /^[\w.-]+$/)
})

test('server errors keep the tap and retry (bounded); they never drop dependent taps', async () => {
  const timers = manualTimers()
  let fail = true
  const sent = []
  const queue = createActionQueue({
    ...timers,
    send: async (a) => {
      if (fail) throw Object.assign(new Error('Server error'), { status: 500 })
      sent.push(a.op)
      return {}
    },
  })
  const a = await queue.submit({ kind: 'status', tripId: 't1', op: 'arrive' })
  await queue.submit({ kind: 'status', tripId: 't1', op: 'start' })
  assert.equal(a.status, 'queued')
  assert.equal(queue.state().pending, 2)
  assert.equal(queue.state().offline, false)
  fail = false
  await queue.flush()
  assert.deepEqual(sent, ['arrive', 'start'])

  const inFlight = createActionQueue({ ...manualTimers(), send: async () => { throw Object.assign(new Error('busy'), { status: 409, code: 'idempotency_in_progress' }) } })
  assert.equal((await inFlight.submit({ kind: 'status', tripId: 't1', op: 'arrive' })).status, 'queued')

  let attempts = 0
  const events = []
  const broken = createActionQueue({ ...manualTimers(), onEvent: (e) => events.push(e.type), send: async () => { attempts++; throw Object.assign(new Error('down'), { status: 500 }) } })
  await broken.submit({ kind: 'status', tripId: 't1', op: 'arrive' })
  for (let i = 0; i < 12; i++) await broken.flush()
  assert.ok(attempts <= 10)
  assert.equal(broken.state().pending, 0)
  assert.deepEqual(events, ['failed'])
})

test('persistence never lets an older snapshot land after a newer one', async () => {
  const writes = []
  const storage = {
    getItem: async () => null,
    // The first write is slow: without serialization it would finish last.
    setItem: (k, v) => new Promise((r) => setTimeout(() => { writes.push(v); r() }, writes.length === 0 ? 30 : 0)),
    removeItem: async () => { writes.push('<removed>') },
  }
  const queue = createActionQueue({ storage, ...manualTimers(), send: async () => { throw offlineErr() } })
  await Promise.all([
    queue.submit({ kind: 'status', tripId: 't1', op: 'arrive' }),
    queue.submit({ kind: 'status', tripId: 't1', op: 'start' }),
  ])
  await new Promise((r) => setTimeout(r, 60))
  const last = JSON.parse(writes[writes.length - 1])
  assert.deepEqual(last.map((a) => a.op), ['arrive', 'start'])
})

test('a terminal server status wins over saved taps', () => {
  assert.equal(projectTripStatus('canceled', [{ tripId: 't', kind: 'status', op: 'start' }], 't'), 'canceled')
  assert.equal(projectTripStatus('completed', [{ tripId: 't', kind: 'status', op: 'arrive' }], 't'), 'completed')
})
