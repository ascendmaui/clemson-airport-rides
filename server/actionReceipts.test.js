import test from 'node:test'
import assert from 'node:assert/strict'
import { claimReceipt, finishReceipt, idempotencyKeyFrom, receiptOp, withActionReceipts } from './actionReceipts.js'

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
const TRIP = '11111111-1111-1111-1111-111111111111'

/** Minimal in-memory driver_action_receipts table with a unique key. */
function receiptsDb() {
  const rows = new Map()
  const from = () => {
    const q = { op: 'select', filters: [], patch: null }
    const match = (row) => q.filters.every(([c, v]) => String(row[c]) === String(v))
    const run = () => {
      if (q.op === 'insert') {
        if (rows.has(q.patch.idempotency_key)) return { error: { code: '23505', message: 'duplicate key' } }
        rows.set(q.patch.idempotency_key, { created_at: new Date().toISOString(), ...q.patch })
        return { error: null }
      }
      const hits = [...rows.values()].filter(match)
      if (q.op === 'update') { for (const r of hits) Object.assign(r, q.patch); return { data: hits.map((r) => ({ idempotency_key: r.idempotency_key })), error: null } }
      if (q.op === 'delete') { for (const r of hits) rows.delete(r.idempotency_key); return { error: null } }
      return { data: hits[0] || null, error: null }
    }
    const chain = {
      insert(row) { q.op = 'insert'; q.patch = row; return Promise.resolve(run()) },
      update(patch) { q.op = 'update'; q.patch = patch; return chain },
      delete() { q.op = 'delete'; return chain },
      select() { return chain },
      eq(c, v) { q.filters.push([c, v]); return chain },
      maybeSingle: async () => run(),
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return chain
  }
  return { rows, from }
}

test('idempotency keys come from the body and are validated', () => {
  assert.deepEqual(idempotencyKeyFrom({}, {}), { key: null })
  assert.deepEqual(idempotencyKeyFrom({}, { idempotencyKey: 'drv-abc-123' }), { key: 'drv-abc-123' })
  assert.deepEqual(idempotencyKeyFrom({ headers: { 'idempotency-key': 'drv-hdr-123' } }, {}), { key: 'drv-hdr-123' })
  assert.deepEqual(idempotencyKeyFrom({}, { idempotencyKey: 'bad key!' }), { error: 'invalid_idempotency_key' })
  assert.equal(receiptOp({ op: 'arrive' }), 'arrive')
  assert.equal(receiptOp({ op: 'drop', stopIndex: 2 }), 'stop:2:drop')
})

test('without a key the handler runs unchanged and nothing is stored', async () => {
  const db = receiptsDb()
  let ran = 0
  const res = fakeRes()
  await withActionReceipts({ method: 'POST', body: { tripId: TRIP, op: 'arrive' } }, res, { sb: db, user },
    async (_req, r) => { ran++; json(r, 200, { ok: true }) }, helpers)
  assert.equal(ran, 1)
  assert.equal(db.rows.size, 0)
  assert.deepEqual(res.body, { ok: true })
})

test('first attempt stores the 2xx response before replying; a retry replays it', async () => {
  const db = receiptsDb()
  let ran = 0
  const inner = async (_req, r) => { ran++; json(r, 200, { ok: true, trip: { status: 'arrived' } }) }
  const req = { method: 'POST', body: { tripId: TRIP, op: 'arrive', idempotencyKey: 'drv-key-0001' } }
  const first = fakeRes()
  await withActionReceipts(req, first, { sb: db, user }, inner, helpers)
  assert.equal(first.body.trip.status, 'arrived')
  assert.equal(db.rows.get('drv-key-0001').http_status, 200)
  const retry = fakeRes()
  await withActionReceipts(req, retry, { sb: db, user }, inner, helpers)
  assert.equal(ran, 1)
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.trip.status, 'arrived')
})

test('a key reused by another driver, trip, or op is a conflict, never a replay', async () => {
  const db = receiptsDb()
  const inner = async (_req, r) => json(r, 200, { ok: true })
  await withActionReceipts({ method: 'POST', body: { tripId: TRIP, op: 'arrive', idempotencyKey: 'drv-key-0002' } }, fakeRes(), { sb: db, user }, inner, helpers)
  for (const [body, who] of [
    [{ tripId: TRIP, op: 'arrive' }, { id: 'someone-else' }],
    [{ tripId: '22222222-2222-2222-2222-222222222222', op: 'arrive' }, user],
    [{ tripId: TRIP, op: 'start' }, user],
  ]) {
    const res = fakeRes()
    let ran = 0
    await withActionReceipts({ method: 'POST', body: { ...body, idempotencyKey: 'drv-key-0002' } }, res, { sb: db, user: who }, async () => { ran++ }, helpers)
    assert.equal(res.statusCode, 409)
    assert.equal(res.body.code, 'idempotency_conflict')
    assert.equal(ran, 0)
  }
})

test('a concurrent retry waits instead of running the action twice', async () => {
  const db = receiptsDb()
  let ran = 0
  let release
  const gate = new Promise((r) => { release = r })
  const slow = async (_req, r) => { ran++; await gate; json(r, 200, { ok: true }) }
  const req = { method: 'POST', body: { tripId: TRIP, op: 'start', idempotencyKey: 'drv-key-0003' } }
  const a = fakeRes()
  const first = withActionReceipts(req, a, { sb: db, user }, slow, helpers)
  await new Promise((r) => setImmediate(r))
  const b = fakeRes()
  await withActionReceipts(req, b, { sb: db, user }, slow, helpers)
  assert.equal(b.statusCode, 409)
  assert.equal(b.body.code, 'idempotency_in_progress')
  release()
  await first
  assert.equal(ran, 1)
  assert.equal(a.statusCode, 200)
})

test('errors release the claim, so the same key can be retried', async () => {
  const db = receiptsDb()
  const req = { method: 'POST', body: { tripId: TRIP, stopIndex: 1, op: 'drop', idempotencyKey: 'drv-key-0004' } }
  const res = fakeRes()
  await withActionReceipts(req, res, { sb: db, user }, async (_req, r) => json(r, 409, { ok: false, code: 'stop_conflict' }), helpers)
  assert.equal(res.statusCode, 409)
  assert.equal(db.rows.size, 0)
  await assert.rejects(withActionReceipts(req, fakeRes(), { sb: db, user }, async () => { throw new Error('boom') }, helpers), /boom/)
  assert.equal(db.rows.size, 0)
  const ok = fakeRes()
  await withActionReceipts(req, ok, { sb: db, user }, async (_req, r) => json(r, 200, { ok: true }), helpers)
  assert.equal(ok.statusCode, 200)
  assert.equal(db.rows.get('drv-key-0004').op, 'stop:1:drop')
})

test('a stale in-flight claim can be taken over; a missing table runs the action plainly', async () => {
  const db = receiptsDb()
  db.rows.set('drv-key-0005', { idempotency_key: 'drv-key-0005', driver_id: user.id, trip_id: TRIP, op: 'arrive', http_status: 0, response: {}, created_at: new Date(Date.now() - 5 * 60000).toISOString() })
  assert.deepEqual(await claimReceipt(db, { key: 'drv-key-0005', driverId: user.id, tripId: TRIP, op: 'arrive' }), { claimed: true })
  const missing = { from: () => ({ insert: async () => ({ error: { code: 'PGRST205', message: "Could not find the table 'public.driver_action_receipts' in the schema cache" } }) }) }
  assert.deepEqual(await claimReceipt(missing, { key: 'drv-key-0006', driverId: user.id, tripId: TRIP, op: 'arrive' }), { unavailable: true })
  let ran = 0
  const res = fakeRes()
  await withActionReceipts({ method: 'POST', body: { tripId: TRIP, op: 'arrive', idempotencyKey: 'drv-key-0006' } }, res, { sb: missing, user },
    async (_req, r) => { ran++; json(r, 200, { ok: true }) }, helpers)
  assert.equal(ran, 1)
  assert.equal(res.statusCode, 200)
  await finishReceipt(missing, { key: 'x', status: 200, body: {} })
})

test('an invalid key is rejected before the handler runs', async () => {
  let ran = 0
  const res = fakeRes()
  await withActionReceipts({ method: 'POST', body: { tripId: TRIP, op: 'arrive', idempotencyKey: 'no spaces allowed' } }, res,
    { sb: receiptsDb(), user }, async () => { ran++ }, helpers)
  assert.equal(ran, 0)
  assert.equal(res.statusCode, 400)
})
