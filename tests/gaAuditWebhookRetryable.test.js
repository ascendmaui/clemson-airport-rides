import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import handler from '../api/stripe-webhook.js'

function mockRequest({ method = 'POST', headers = {}, body = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.headers = { ...headers }
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function mockResponse() {
  const res = {
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
  return res
}

test('GA92: checkout.session.completed returns retryable 500 when deposit recording fails', async () => {
  const req = mockRequest({
    body: {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_retry_1',
          metadata: { tripId: 'trip_1', kind: 'airport_deposit' },
          amount_total: 2500,
        },
      },
    },
  })
  const res = mockResponse()

  const fakeDeps = {
    stripeSecret: 'sk_test_fake',
    webhookSecret: '',
    serviceKey: 'svc_key_test',
    serviceClient: () => ({}),
    applyPaidCheckoutSession: async () => ({
      ok: false,
      recorded: { ok: false, error: 'Postgres connection timeout' },
      live: { restored: false },
      referral: { ok: false },
    }),
  }

  await handler(req, res, fakeDeps)
  assert.equal(res.statusCode, 500, 'Returns 500 so Stripe retries event delivery')
  const body = JSON.parse(res.body)
  assert.equal(body.recorded.ok, false)
  assert.equal(body.recorded.error, 'Postgres connection timeout')
})

test('GA92: checkout.session.async_payment_succeeded returns retryable 500 when applied.ok is false', async () => {
  const req = mockRequest({
    body: {
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          id: 'cs_test_retry_2',
          metadata: { tripId: 'trip_2', kind: 'airport_deposit' },
          amount_total: 2500,
        },
      },
    },
  })
  const res = mockResponse()

  const fakeDeps = {
    stripeSecret: 'sk_test_fake',
    webhookSecret: '',
    serviceKey: 'svc_key_test',
    serviceClient: () => ({}),
    applyPaidCheckoutSession: async () => ({
      ok: false,
      recorded: { ok: false, reason: 'database_unavailable' },
      live: { restored: false },
      referral: { ok: false },
    }),
  }

  await handler(req, res, fakeDeps)
  assert.equal(res.statusCode, 500, 'Returns 500 on async payment apply failure')
})

test('GA92: credit_purchase returns retryable 500 when grantCreditPack fails', async () => {
  const req = mockRequest({
    body: {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_credit_fail',
          metadata: { profile_id: 'prof_1', pack_id: 'pack_10', kind: 'credit_purchase' },
          payment_intent: 'pi_credit_fail',
        },
      },
    },
  })
  const res = mockResponse()

  const fakeDeps = {
    stripeSecret: 'sk_test_fake',
    webhookSecret: '',
    serviceKey: 'svc_key_test',
    recordCreditPurchase: async () => ({ ok: false, error: 'db lock failure' }),
  }

  await handler(req, res, fakeDeps)
  assert.equal(res.statusCode, 500, 'Returns 500 when credit grant fails')
  const body = JSON.parse(res.body)
  assert.equal(body.granted.ok, false)
})

test('GA92: stream guards prevent exceptions when headersSent or writableEnded are preset', async () => {
  const req = mockRequest({
    body: {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_guard_1' } },
    },
  })
  const res = mockResponse()
  // Simulate client connection termination where headers and stream were closed early
  res.headersSent = true
  res.writableEnded = true

  const fakeDeps = {
    stripeSecret: 'sk_test_fake',
    webhookSecret: '',
    applyPaidCheckoutSession: async () => ({ ok: true, recorded: { ok: true } }),
  }

  // Must not throw ERR_HTTP_HEADERS_SENT or ERR_STREAM_ALREADY_ENDED
  await handler(req, res, fakeDeps)
  assert.equal(res.writableEnded, true)
})
