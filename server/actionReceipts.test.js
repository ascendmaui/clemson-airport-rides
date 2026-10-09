import test from 'node:test'
import assert from 'node:assert/strict'
import { idempotencyKeyFrom, withActionReceipts } from './actionReceipts.js'

function fakeRes() {
  return {
    statusCode: 200, body: null, headersSent: false, writableEnded: false, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    end(chunk) { this.writableEnded = true; this.body = chunk ? JSON.parse(chunk) : null; return this },
  }
}
const json = (res, status, body) => { if (res.writableEnded) return; res.statusCode = status; res.end(JSON.stringify(body)) }
const parseBody = (req) => ({ body: req.body || {} })
const helpers = { admin: () => null, json, parseBody, userFromAuth: async () => null }
const user = { id: 'driver-1' }

test('idempotency keys come from the body and are validated', () => {
  assert.deepEqual(idempotencyKeyFrom({}, {}), { key: null })
  assert.deepEqual(idempotencyKeyFrom({}, { idempotencyKey: 'drv-abc-123' }), { key: 'drv-abc-123' })
  assert.deepEqual(idempotencyKeyFrom({ headers: { 'idempotency-key': 'drv-hdr-123' } }, {}), { key: 'drv-hdr-123' })
  assert.deepEqual(idempotencyKeyFrom({}, { idempotencyKey: 'bad key!' }), { error: 'invalid_idempotency_key' })
})

test('without a key the handler runs unchanged and nothing is stored', async () => {
  let ran = 0
  const writes = []
  const res = fakeRes()
  await withActionReceipts({ method: 'POST', body: { tripId: 't', op: 'arrive' } }, res, { sb: {}, user, writeReceipt: async (_s, r) => writes.push(r), readReceipt: async () => null },
    async (_req, r) => { ran++; json(r, 200, { ok: true }) }, helpers)
  assert.equal(ran, 1)
  assert.equal(writes.length, 0)
  assert.deepEqual(res.body, { ok: true })
})

test('first attempt stores the 2xx response before replying; a retry replays it', async () => {
  const store = new Map()
  const deps = {
    sb: {}, user,
    readReceipt: async (_sb, key, driverId) => {
      const r = store.get(key)
      if (!r) return null
      if (r.driverId !== driverId) return { conflict: true }
      return { status: r.status, body: { ...r.body, idempotent: true, replayed: true } }
    },
    writeReceipt: async (_sb, r) => { store.set(r.key, r) },
  }
  let ran = 0
  const inner = async (_req, r) => { ran++; json(r, 200, { ok: true, trip: { status: 'arrived' } }) }
  const req = { method: 'POST', body: { tripId: 't1', op: 'arrive', idempotencyKey: 'drv-key-0001' } }
  const first = fakeRes()
  await withActionReceipts(req, first, deps, inner, helpers)
  assert.equal(first.body.trip.status, 'arrived')
  assert.equal(store.get('drv-key-0001').op, 'arrive')
  assert.equal(store.get('drv-key-0001').tripId, 't1')

  const retry = fakeRes()
  await withActionReceipts(req, retry, deps, inner, helpers)
  assert.equal(ran, 1)
  assert.equal(retry.statusCode, 200)
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.trip.status, 'arrived')

  const other = fakeRes()
  await withActionReceipts(req, other, { ...deps, user: { id: 'someone-else' } }, inner, helpers)
  assert.equal(other.statusCode, 409)
  assert.equal(other.body.code, 'idempotency_conflict')
})

test('errors are not stored, so the same key can be retried', async () => {
  const writes = []
  const res = fakeRes()
  await withActionReceipts({ method: 'POST', body: { tripId: 't1', stopIndex: 1, op: 'drop', idempotencyKey: 'drv-key-0002' } }, res,
    { sb: {}, user, readReceipt: async () => null, writeReceipt: async (_s, r) => writes.push(r) },
    async (_req, r) => json(r, 409, { ok: false, code: 'stop_out_of_order' }), helpers)
  assert.equal(res.statusCode, 409)
  assert.equal(writes.length, 0)
})

test('stop receipts record the stop index in the op', async () => {
  const writes = []
  await withActionReceipts({ method: 'POST', body: { tripId: 't1', stopIndex: 2, op: 'drop', idempotencyKey: 'drv-key-0003' } }, fakeRes(),
    { sb: {}, user, readReceipt: async () => null, writeReceipt: async (_s, r) => writes.push(r) },
    async (_req, r) => json(r, 200, { ok: true }), helpers)
  assert.equal(writes[0].op, 'stop:2:drop')
})

test('an invalid key is rejected before the handler runs', async () => {
  let ran = 0
  const res = fakeRes()
  await withActionReceipts({ method: 'POST', body: { tripId: 't1', op: 'arrive', idempotencyKey: 'no spaces allowed' } }, res,
    { sb: {}, user }, async () => { ran++ }, helpers)
  assert.equal(ran, 0)
  assert.equal(res.statusCode, 400)
})
