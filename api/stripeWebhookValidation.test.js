/**
 * Input validation for api/stripe-webhook.js default handler(req, res, deps).
 * Covers method checks, stub mode, Stripe-Signature verification, and the
 * unsigned (empty or placeholder webhook secret) body parser.
 * Production source is not modified. Suspected bugs are marked BUG?:.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import Stripe from 'stripe'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('STRIPE_') || key.startsWith('SUPABASE_') || key.startsWith('GOOGLE_')) {
    delete process.env[key]
  }
}

const { default: handler } = await import('./stripe-webhook.js')

const STRIPE_SECRET = 'sk_test_fake_not_real'
const WEBHOOK_SECRET = 'whsec_fake_not_real'
const WRONG_WEBHOOK_SECRET = 'whsec_wrong_fake_not_real'

const stripe = new Stripe(STRIPE_SECRET)

const ACCEPTED_EVENT = {
  id: 'evt_validation_accepted',
  object: 'event',
  type: 'customer.created',
  data: { object: { id: 'cus_validation', object: 'customer' } },
}

const UNSIGNED_SECRETS = [
  { label: 'empty webhook secret', webhookSecret: '' },
  { label: 'placeholder webhook secret', webhookSecret: 'whsec_placeholder' },
]

function mockRes() {
  return {
    statusCode: 0,
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

function mockReq({ method = 'POST', headers = {}, body = '' } = {}) {
  const buf = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const stream = Readable.from([buf])
  stream.method = method
  stream.headers = headers
  return stream
}

// Reading this request throws. Stub mode and the method check return before readRawBody.
function closedReq({ method = 'POST', headers = {} } = {}) {
  return {
    method,
    headers,
    on() {
      throw new Error('request body was read')
    },
  }
}

function trackingDeps(overrides = {}) {
  const { omitStripeSecret = false, ...rest } = overrides
  const calls = []
  const deps = {
    stripeSecret: STRIPE_SECRET,
    webhookSecret: WEBHOOK_SECRET,
    serviceKey: '',
    serviceClient() {
      calls.push('serviceClient')
      return {}
    },
    applyPaidCheckoutSession() {
      calls.push('applyPaidCheckoutSession')
      return { recorded: null, live: null, referral: null }
    },
    restoreLiveTripAfterDeposit() {
      calls.push('restoreLiveTripAfterDeposit')
      return { restored: false }
    },
    grantRiderSocialForTrip() {
      calls.push('grantRiderSocialForTrip')
      return { ok: true, granted: false }
    },
    ...rest,
  }
  if (omitStripeSecret) delete deps.stripeSecret
  return { calls, deps }
}

function signedReq(raw, { secret = WEBHOOK_SECRET, timestamp, send = raw, includeHeader = true } = {}) {
  const headers = {}
  if (includeHeader) {
    headers['stripe-signature'] = stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret,
      ...(timestamp == null ? {} : { timestamp }),
    })
  }
  return mockReq({ method: 'POST', headers, body: send })
}

async function callHandler(req, deps) {
  const res = mockRes()
  const unhandled = []
  const onUnhandled = (err) => { unhandled.push(err) }
  process.on('unhandledRejection', onUnhandled)
  try {
    await handler(req, res, deps)
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  assert.equal(unhandled.length, 0, unhandled[0] && String(unhandled[0]))
  return res
}

function assertJson(res, status) {
  assert.equal(res.statusCode, status)
  assert.equal(res.headers['content-type'], 'application/json')
  assert.equal(typeof res.body, 'string')
  assert.notEqual(res.body, '')
  return JSON.parse(res.body)
}

function assertNoDownstream(calls) {
  assert.deepEqual(calls, [])
}

const NON_POST_METHODS = ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'post']

for (const method of NON_POST_METHODS) {
  test(`${method} returns 405 and does not read the body`, async () => {
    const { calls, deps } = trackingDeps()
    const res = await callHandler(closedReq({
      method,
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    }), deps)
    const body = assertJson(res, 405)
    assert.deepEqual(body, { error: 'Method not allowed' })
    assertNoDownstream(calls)
  })
}

test('a request with no method returns 405', async () => {
  const { calls, deps } = trackingDeps()
  const req = closedReq()
  delete req.method
  const res = await callHandler(req, deps)
  const body = assertJson(res, 405)
  assert.deepEqual(body, { error: 'Method not allowed' })
  assertNoDownstream(calls)
})

const STUB_SECRETS = [
  { label: 'omitted stripe secret', overrides: { omitStripeSecret: true } },
  { label: 'empty stripe secret', overrides: { stripeSecret: '' } },
  { label: 'secret without sk_ prefix', overrides: { stripeSecret: 'pk_test_fake_not_real' } },
  { label: 'sk_ secret containing placeholder', overrides: { stripeSecret: 'sk_test_placeholder' } },
]

for (const spec of STUB_SECRETS) {
  test(`stub mode (${spec.label}) returns 200 and does not parse the body`, async () => {
    const { calls, deps } = trackingDeps({
      ...spec.overrides,
      webhookSecret: WEBHOOK_SECRET,
    })
    const res = await callHandler(closedReq({
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=not-a-real-signature' },
    }), deps)
    const body = assertJson(res, 200)
    assert.deepEqual(body, {
      stub: true,
      message: 'STRIPE_SECRET_KEY not set — webhook stub acknowledged',
    })
    assertNoDownstream(calls)
  })
}

test('a locally signed header is accepted', async () => {
  const raw = JSON.stringify(ACCEPTED_EVENT)
  const { calls, deps } = trackingDeps()
  const res = await callHandler(signedReq(raw), deps)
  const body = assertJson(res, 200)
  assert.deepEqual(body, { received: true, type: 'customer.created' })
  assertNoDownstream(calls)
})

test('a missing stripe-signature header is 400 and does not apply the event', async () => {
  const raw = JSON.stringify(ACCEPTED_EVENT)
  const { calls, deps } = trackingDeps()
  const res = await callHandler(signedReq(raw, { includeHeader: false }), deps)
  const body = assertJson(res, 400)
  assert.match(body.error, /No stripe-signature header value was provided/)
  assert.equal(body.received, undefined)
  assertNoDownstream(calls)
})

test('a tampered body is 400 and does not apply the event', async () => {
  const raw = JSON.stringify(ACCEPTED_EVENT)
  const send = raw.replace('cus_validation', 'cus_tampered')
  assert.notEqual(send, raw)
  const { calls, deps } = trackingDeps()
  const res = await callHandler(signedReq(raw, { send }), deps)
  const body = assertJson(res, 400)
  assert.match(body.error, /No signatures found matching the expected signature for payload/)
  assertNoDownstream(calls)
})

test('a header signed with the wrong secret is 400 and does not apply the event', async () => {
  const raw = JSON.stringify(ACCEPTED_EVENT)
  const { calls, deps } = trackingDeps()
  const res = await callHandler(signedReq(raw, { secret: WRONG_WEBHOOK_SECRET }), deps)
  const body = assertJson(res, 400)
  assert.match(body.error, /No signatures found matching the expected signature for payload/)
  assertNoDownstream(calls)
})

test('a stale signature timestamp is 400 and does not apply the event', async () => {
  const raw = JSON.stringify(ACCEPTED_EVENT)
  const { calls, deps } = trackingDeps()
  const res = await callHandler(signedReq(raw, {
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  }), deps)
  const body = assertJson(res, 400)
  assert.match(body.error, /Timestamp outside the tolerance zone/)
  assertNoDownstream(calls)
})

for (const spec of UNSIGNED_SECRETS) {
  test(`unsigned (${spec.label}) malformed JSON is 400`, async () => {
    const { calls, deps } = trackingDeps({ webhookSecret: spec.webhookSecret })
    const res = await callHandler(mockReq({
      body: '{',
      headers: { 'stripe-signature': 't=1,v1=ignored' },
    }), deps)
    const body = assertJson(res, 400)
    assert.match(body.error, /JSON|Expected property name|Unexpected token|Unexpected end/i)
    assert.doesNotMatch(body.error, /stripe-signature|No signatures found|Timestamp outside/)
    assertNoDownstream(calls)
  })

  test(`unsigned (${spec.label}) empty body is 400`, async () => {
    const { calls, deps } = trackingDeps({ webhookSecret: spec.webhookSecret })
    const res = await callHandler(mockReq({ body: '' }), deps)
    const body = assertJson(res, 400)
    assert.match(body.error, /Unexpected end of JSON input/)
    assertNoDownstream(calls)
  })

  // BUG?: unsigned mode never checks that the payload is an event object.
  // `null` throws on `event.type` and the catch returns 400. A JSON array,
  // including one that wraps a real event, does not throw, matches no
  // `event.type === ...` branch, and is acknowledged 200 {received:true}.
  // The wrapped event is not applied and the caller is not told to retry.
  test(`unsigned (${spec.label}) JSON array is 200 unhandled`, async () => {
    const wrapped = JSON.stringify([{
      id: 'evt_wrapped',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_wrapped', object: 'checkout.session' } },
    }])
    for (const bodyText of ['[]', wrapped]) {
      const { calls, deps } = trackingDeps({ webhookSecret: spec.webhookSecret })
      const res = await callHandler(mockReq({ body: bodyText }), deps)
      const body = assertJson(res, 200)
      assert.equal(body.received, true)
      assert.equal(Object.hasOwn(body, 'type'), false)
      assert.equal(body.error, undefined)
      assertNoDownstream(calls)
    }
  })

  test(`unsigned (${spec.label}) JSON null is 400`, async () => {
    const { calls, deps } = trackingDeps({ webhookSecret: spec.webhookSecret })
    const res = await callHandler(mockReq({ body: 'null' }), deps)
    const body = assertJson(res, 400)
    assert.match(body.error, /Cannot read properties of null/)
    assertNoDownstream(calls)
  })

  // Documented: an object with no `type` falls through to the unhandled
  // branch, 200 {received:true}. `type` is omitted because it is undefined.
  test(`unsigned (${spec.label}) event without type is 200 unhandled`, async () => {
    const raw = JSON.stringify({
      id: 'evt_no_type',
      object: 'event',
      data: { object: { id: 'cus_no_type', object: 'customer' } },
    })
    const { calls, deps } = trackingDeps({ webhookSecret: spec.webhookSecret })
    const res = await callHandler(mockReq({ body: raw }), deps)
    const body = assertJson(res, 200)
    assert.equal(body.received, true)
    assert.equal(Object.hasOwn(body, 'type'), false)
    assertNoDownstream(calls)
  })

  // Documented: a recognized-looking event that simply is not one of the
  // handled types, and that has no `data.object`, is 200 unhandled.
  test(`unsigned (${spec.label}) event without data.object is 200 unhandled`, async () => {
    const raw = JSON.stringify({
      id: 'evt_no_object',
      object: 'event',
      type: 'customer.created',
    })
    const { calls, deps } = trackingDeps({ webhookSecret: spec.webhookSecret })
    const res = await callHandler(mockReq({ body: raw }), deps)
    const body = assertJson(res, 200)
    assert.deepEqual(body, { received: true, type: 'customer.created' })
    assertNoDownstream(calls)
  })
}
