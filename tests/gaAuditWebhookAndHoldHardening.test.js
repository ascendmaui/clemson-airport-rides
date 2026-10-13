import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import handler, { readRawBody } from '../api/stripe-webhook.js'
import {
  releaseExpiredUnpaidAirportHold,
  releaseExpiredUnpaidAirportHolds,
} from '../server/abandonedCheckout.js'

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(key, val) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT')
      this.headers[key.toLowerCase()] = val
    },
    end(chunk) {
      if (this.writableEnded) throw new Error('ERR_STREAM_ALREADY_ENDED')
      this.writableEnded = true
      this.headersSent = true
      if (chunk) this.body += chunk
      return this
    },
  }
}

test('GA97: readRawBody resolves immediately with pre-buffered Buffer or string without waiting for stream', async () => {
  const buf = Buffer.from('{"hello":"world"}')
  const reqWithBuf = { rawBody: buf }
  const resBuf = await readRawBody(reqWithBuf)
  assert.deepEqual(resBuf, buf)

  const str = '{"hello":"string"}'
  const reqWithStr = { rawBody: str }
  const resStr = await readRawBody(reqWithStr)
  assert.equal(resStr.toString('utf8'), str)

  const reqWithBodyBuf = { body: buf }
  const resBodyBuf = await readRawBody(reqWithBodyBuf)
  assert.deepEqual(resBodyBuf, buf)

  const reqWithBodyStr = { body: str }
  const resBodyStr = await readRawBody(reqWithBodyStr)
  assert.equal(resBodyStr.toString('utf8'), str)
})

test('GA97: readRawBody enforces maxBytes ceiling and rejects oversized payload', async () => {
  const stream = Readable.from([Buffer.alloc(2048, 'a')])
  await assert.rejects(
    () => readRawBody(stream, 1024),
    /Payload too large/,
  )
})

test('GA97: webhook handler accepts restricted API keys (rk_test_... / rk_live_...)', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: JSON.stringify({ id: 'evt_rk_test', object: 'event', type: 'unhandled.event' }),
  }
  const res = mockRes()
  await handler(req, res, {
    stripeSecret: 'rk_test_restricted_key_sample',
    webhookSecret: '',
  })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.stub, undefined, 'Restricted key is not treated as a stub')
  assert.equal(body.received, true)
})

test('GA97: webhook handler returns 500 when applyPaidCheckoutSession returns non-skipped error', async () => {
  const session = {
    id: 'cs_test_failed_apply',
    object: 'checkout.session',
    metadata: {
      tripId: 'trip_apply_fail',
      kind: 'airport_deposit',
    },
  }
  const req = {
    method: 'POST',
    headers: {},
    body: JSON.stringify({
      id: 'evt_apply_fail',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: session },
    }),
  }
  const res = mockRes()
  await handler(req, res, {
    stripeSecret: 'sk_test_mock',
    webhookSecret: '',
    applyPaidCheckoutSession: async () => ({
      ok: false,
      skipped: false,
      error: 'database_timeout_error',
      recorded: { ok: false },
    }),
  })

  assert.equal(res.statusCode, 500, 'Returns 500 so Stripe will retry webhook delivery')
  const body = JSON.parse(res.body)
  assert.equal(body.received, true)
  assert.equal(body.error, 'database_timeout_error')
})

test('GA97: releaseExpiredUnpaidAirportHolds handles NaN, null, and non-numeric now safely without RangeError', async () => {
  const fakeDb = {
    from() {
      return {
        select() { return this },
        in() { return this },
        is() { return this },
        gt() { return this },
        lte() { return this },
        order() { return this },
        limit() {
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  }

  const resNan = await releaseExpiredUnpaidAirportHolds(fakeDb, { now: NaN })
  assert.equal(resNan.ok, true)
  assert.equal(resNan.errors, 0)

  const resNull = await releaseExpiredUnpaidAirportHolds(fakeDb, { now: null })
  assert.equal(resNull.ok, true)
  assert.equal(resNull.errors, 0)

  const resInvalidStr = await releaseExpiredUnpaidAirportHolds(fakeDb, { now: 'invalid-date' })
  assert.equal(resInvalidStr.ok, true)
  assert.equal(resInvalidStr.errors, 0)
})

test('GA97: releaseExpiredUnpaidAirportHolds returns database_client_required when sb is missing', async () => {
  const resNull = await releaseExpiredUnpaidAirportHolds(null)
  assert.equal(resNull.ok, false)
  assert.equal(resNull.reason, 'database_client_required')
  assert.equal(resNull.errors, 1)

  const resEmpty = await releaseExpiredUnpaidAirportHolds({})
  assert.equal(resEmpty.ok, false)
  assert.equal(resEmpty.reason, 'database_client_required')
})

test('GA97: releaseExpiredUnpaidAirportHold handles NaN now without throwing', async () => {
  const trip = {
    id: 'trip_1',
    status: 'searching',
    deposit_cents: 2500,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    metadata: { kind: 'airport' },
  }
  const fakeDb = {
    from() {
      const q = {
        select() { return q },
        eq() { return q },
        in() { return q },
        is() { return q },
        maybeSingle() { return Promise.resolve({ data: trip, error: null }) },
        update() { return q },
        insert() { return Promise.resolve({ data: null, error: null }) },
      }
      return q
    },
  }

  const result = await releaseExpiredUnpaidAirportHold(fakeDb, trip, { now: NaN, payments: [] })
  assert.equal(typeof result, 'object')
})
