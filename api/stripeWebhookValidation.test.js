/**
 * Validation for api/stripe-webhook.js default handler(req, res, deps).
 * Covers method checks, stub mode, Stripe-Signature verification, the
 * unsigned body parser, and event routing after a payload is accepted.
 * Production source is not modified. Suspected bugs are marked BUG?:.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'
import { Readable } from 'node:stream'
import Stripe from 'stripe'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('STRIPE_') || key.startsWith('SUPABASE_') || key.startsWith('GOOGLE_')) {
    delete process.env[key]
  }
}

const { default: handler } = await import('./stripe-webhook.js')

// recordTip / recordCreditPurchase close over the service key captured at
// import. This second instance is evaluated with a fake key so the
// missing_metadata branch can run. Its @supabase/supabase-js import is
// tests/fixtures/webhook-validation/fakeSupabase.js. These tests never pass
// metadata that would construct a client.
register(new URL('../tests/fixtures/webhook-validation/hooks.js', import.meta.url).href, {
  parentURL: import.meta.url,
})
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_fake_not_real'
let handlerWithServiceKey
try {
  ;({ default: handlerWithServiceKey } = await import('./stripe-webhook.js?instance=routing'))
} finally {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
}
assert.notEqual(handlerWithServiceKey, handler)

const STRIPE_SECRET = 'sk_test_fake_not_real'
const WEBHOOK_SECRET = 'whsec_fake_not_real'
const WRONG_WEBHOOK_SECRET = 'whsec_wrong_fake_not_real'
const SERVICE_ROLE = 'service_role_fake_not_real'

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

async function callHandler(req, deps, handlerFn = handler) {
  const res = mockRes()
  const unhandled = []
  const onUnhandled = (err) => { unhandled.push(err) }
  process.on('unhandledRejection', onUnhandled)
  try {
    await handlerFn(req, res, deps)
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

// --- event routing (unsigned body; signature acceptance is covered above) ---

function snapshotQuery(state, terminal) {
  return {
    table: state.table,
    op: state.op,
    payload: state.payload,
    filters: state.filters.map((filter) => ({ ...filter })),
    terminal,
  }
}

// Records the chain setPaymentHold / releaseUnpaidCheckoutTrip actually call.
function recordingClient(respond) {
  const calls = []
  function record(call) {
    calls.push(call)
    return respond(call)
  }
  function from(table) {
    const state = { table, op: 'select', payload: null, filters: [] }
    const chain = {
      select() { return chain },
      insert(payload) { state.op = 'insert'; state.payload = payload; return chain },
      update(payload) { state.op = 'update'; state.payload = payload; return chain },
      delete() { state.op = 'delete'; return chain },
      eq(col, val) { state.filters.push({ op: 'eq', col, val }); return chain },
      neq(col, val) { state.filters.push({ op: 'neq', col, val }); return chain },
      in(col, val) { state.filters.push({ op: 'in', col, val }); return chain },
      is(col, val) { state.filters.push({ op: 'is', col, val }); return chain },
      or(filter) { state.filters.push({ op: 'or', filter }); return chain },
      order() { return chain },
      limit() { return chain },
      maybeSingle() {
        return Promise.resolve(record(snapshotQuery(state, 'maybeSingle')))
      },
      single() {
        return Promise.resolve(record(snapshotQuery(state, 'single')))
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(record(snapshotQuery(state, 'await'))).then(onFulfilled, onRejected)
      },
    }
    return chain
  }
  function rpc(fn, args) {
    return Promise.resolve(record({
      table: null,
      op: 'rpc',
      fn,
      args,
      payload: null,
      filters: [],
      terminal: 'await',
    }))
  }
  return { calls, from, rpc }
}

function routingDeps({ serviceKey = '', client = {}, onApply = null } = {}) {
  const calls = []
  const applied = []
  const deps = {
    stripeSecret: STRIPE_SECRET,
    webhookSecret: '',
    serviceKey,
    serviceClient() {
      calls.push('serviceClient')
      return client
    },
    applyPaidCheckoutSession(sb, session, opts) {
      calls.push('applyPaidCheckoutSession')
      applied.push({ client: sb, session, opts })
      if (onApply) return onApply(sb, session, opts)
      return { recorded: { ok: true }, live: { restored: false }, referral: { ok: true, granted: false } }
    },
    restoreLiveTripAfterDeposit() {
      calls.push('restoreLiveTripAfterDeposit')
      return { restored: false }
    },
    grantRiderSocialForTrip() {
      calls.push('grantRiderSocialForTrip')
      return { ok: true, granted: false }
    },
  }
  return { calls, applied, deps }
}

function postEvent(handlerFn, event, deps) {
  return callHandler(mockReq({ body: JSON.stringify(event) }), deps, handlerFn)
}

function paymentFailedEvent(shape = {}) {
  if (shape.omitData) {
    return { id: 'evt_payment_failed', object: 'event', type: 'payment_intent.payment_failed' }
  }
  const object = shape.object === null
    ? null
    : {
        id: 'pi_fail_1',
        object: 'payment_intent',
        ...(shape.metadata !== undefined ? { metadata: shape.metadata } : {}),
        ...(shape.error !== undefined ? { last_payment_error: shape.error } : {}),
      }
  return {
    id: 'evt_payment_failed',
    object: 'event',
    type: 'payment_intent.payment_failed',
    data: { object },
  }
}

function holdWriter(tripId) {
  return recordingClient((call) => {
    if (call.table === 'trips' && call.terminal === 'maybeSingle') {
      return {
        data: {
          id: tripId,
          status: 'searching',
          metadata: {},
          rider_id: 'rider_hold',
          driver_id: null,
        },
        error: null,
      }
    }
    if (call.table === 'trips' && call.op === 'update') return { data: null, error: null }
    return { data: null, error: { message: `unexpected ${call.op} on ${call.table}` } }
  })
}

function writtenHoldCode(calls) {
  const updates = calls.filter((call) => call.table === 'trips' && call.op === 'update')
  assert.equal(updates.length, 1)
  const hold = updates[0].payload.metadata.payment_hold
  assert.equal(updates[0].filters.some((filter) => filter.op === 'eq' && filter.col === 'id'), true)
  return { code: hold.code, tripId: updates[0].filters.find((filter) => filter.col === 'id').val }
}

const CLASSIFIED_FAILURES = [
  {
    label: 'insufficient_funds',
    error: { decline_code: 'insufficient_funds', code: 'card_declined', message: 'insufficient' },
    code: 'insufficient_funds',
  },
  {
    label: 'expired_card',
    error: { code: 'expired_card', message: 'expired' },
    code: 'expired_card',
  },
  {
    label: 'card_declined',
    error: { code: 'card_declined', message: 'declined' },
    code: 'card_declined',
  },
  {
    label: 'authentication_required',
    error: { code: 'authentication_required', message: 'auth' },
    code: 'authentication_required',
  },
  {
    label: 'card_removed',
    error: { code: 'resource_missing', message: 'No such payment_method' },
    code: 'card_removed',
  },
  {
    label: 'charge_failed',
    error: { message: 'processor unavailable' },
    code: 'charge_failed',
  },
]

const MISSING_TRIP_CASES = [
  { label: 'no data', event: paymentFailedEvent({ omitData: true }), code: 'charge_failed' },
  { label: 'null object', event: paymentFailedEvent({ object: null }), code: 'charge_failed' },
  { label: 'no metadata', event: paymentFailedEvent(), code: 'charge_failed' },
  { label: 'empty metadata', event: paymentFailedEvent({ metadata: {} }), code: 'charge_failed' },
  {
    label: 'blank tripId',
    event: paymentFailedEvent({ metadata: { tripId: '' }, error: { code: 'expired_card', message: 'expired' } }),
    code: 'expired_card',
  },
  { label: 'blank trip_id', event: paymentFailedEvent({ metadata: { trip_id: '' } }), code: 'charge_failed' },
  { label: 'null tripId', event: paymentFailedEvent({ metadata: { tripId: null } }), code: 'charge_failed' },
]

for (const spec of MISSING_TRIP_CASES) {
  test(`payment_failed ${spec.label} returns held:false and does not call serviceClient`, async () => {
    const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE })
    const res = await postEvent(handler, spec.event, deps)
    const body = assertJson(res, 200)
    assert.deepEqual(body, {
      received: true,
      type: 'payment_intent.payment_failed',
      held: false,
      code: spec.code,
    })
    assert.deepEqual(calls, [])
  })
}

test('payment_failed with a tripId and an empty serviceKey returns held:false and does not call serviceClient', async () => {
  const event = paymentFailedEvent({
    metadata: { tripId: 'trip_hold_nokey' },
    error: { code: 'expired_card', message: 'expired' },
  })
  const { calls, deps } = routingDeps({ serviceKey: '' })
  const res = await postEvent(handler, event, deps)
  const body = assertJson(res, 200)
  assert.deepEqual(body, {
    received: true,
    type: 'payment_intent.payment_failed',
    held: false,
    code: 'expired_card',
  })
  assert.deepEqual(calls, [])
})

for (const spec of CLASSIFIED_FAILURES) {
  // The fake client's trips update is what setPaymentHold wrote. Assert the
  // classified code only — amount fields on the hold are out of scope.
  test(`payment_failed stores classified code ${spec.label} on the fake client`, async () => {
    const tripId = `trip_${spec.code}`
    const sb = holdWriter(tripId)
    const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE, client: sb })
    const event = paymentFailedEvent({
      metadata: { tripId },
      error: spec.error,
    })
    const res = await postEvent(handler, event, deps)
    const body = assertJson(res, 200)
    assert.equal(body.held, true)
    assert.equal(body.code, spec.code)
    assert.equal(body.type, 'payment_intent.payment_failed')
    const written = writtenHoldCode(sb.calls)
    assert.equal(written.code, spec.code)
    assert.equal(written.tripId, tripId)
    assert.deepEqual(calls, ['serviceClient'])
  })
}

test('payment_failed accepts metadata.trip_id when tripId is absent', async () => {
  const sb = holdWriter('trip_alias')
  const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE, client: sb })
  const event = paymentFailedEvent({
    metadata: { trip_id: 'trip_alias' },
    error: { code: 'card_declined', message: 'declined' },
  })
  const res = await postEvent(handler, event, deps)
  const body = assertJson(res, 200)
  assert.equal(body.held, true)
  assert.equal(body.code, 'card_declined')
  const written = writtenHoldCode(sb.calls)
  assert.equal(written.code, 'card_declined')
  assert.equal(written.tripId, 'trip_alias')
  assert.deepEqual(calls, ['serviceClient'])
})

// BUG?: payment_intent.payment_failed reports held:true even when setPaymentHold
// does not write. readTrip turns a select error into null, and a missing row
// is also null. setPaymentHold returns without updating, and the handler still
// sets held = true and responds 200, so Stripe will not retry.
for (const read of [
  { label: 'select error', result: { data: null, error: { message: 'trip down' } } },
  { label: 'missing row', result: { data: null, error: null } },
]) {
  test(`payment_failed reports held:true when the trip read returns nothing (${read.label})`, async () => {
    const sb = recordingClient((call) => {
      if (call.table === 'trips' && call.terminal === 'maybeSingle') return read.result
      return { data: null, error: { message: `unexpected ${call.op} on ${call.table}` } }
    })
    const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE, client: sb })
    const event = paymentFailedEvent({
      metadata: { tripId: 'trip_missing_row' },
      error: { code: 'card_declined', message: 'declined' },
    })
    const res = await postEvent(handler, event, deps)
    const body = assertJson(res, 200)
    assert.deepEqual(body, {
      received: true,
      type: 'payment_intent.payment_failed',
      held: true,
      code: 'card_declined',
    })
    assert.equal(sb.calls.some((call) => call.op === 'update'), false)
    assert.deepEqual(calls, ['serviceClient'])
  })
}

const ABANDON_TYPES = ['checkout.session.expired', 'checkout.session.async_payment_failed']
const RETRYABLE_REASONS = ['trip_unreadable', 'payments_unreadable', 'update_failed']

function abandonEvent(type, metadata = { tripId: 'trip_exp', kind: 'airport_deposit' }) {
  return {
    id: `evt_${type}`,
    object: 'event',
    type,
    data: {
      object: {
        id: 'cs_abandon_1',
        object: 'checkout.session',
        status: 'expired',
        payment_status: 'unpaid',
        metadata,
      },
    },
  }
}

function releaseClient(mode) {
  const trip = {
    id: 'trip_exp',
    status: 'searching',
    rider_id: 'rider_exp',
    driver_id: null,
    scheduled_for: null,
    metadata: {},
    canceled_at: null,
  }
  return recordingClient((call) => {
    if (call.op === 'rpc') {
      if (mode === 'update_failed') return { data: null, error: { message: 'write down' } }
      return { data: [{ id: trip.id }], error: null }
    }
    if (call.table === 'trips' && call.terminal === 'maybeSingle') {
      if (mode === 'trip_unreadable') return { data: null, error: { message: 'trip down' } }
      return { data: trip, error: null }
    }
    if (call.table === 'payments') {
      if (mode === 'payments_unreadable') return { data: null, error: { message: 'pay down' } }
      return { data: [], error: null }
    }
    if (call.table === 'trips' && call.op === 'update') return { data: null, error: null }
    if (call.table === 'trip_events') return { data: null, error: null }
    return { data: null, error: { message: `unexpected ${call.op} on ${call.table}` } }
  })
}

for (const type of ABANDON_TYPES) {
  test(`${type} with an empty serviceKey returns no_service_role and does not call serviceClient`, async () => {
    const { calls, deps } = routingDeps({ serviceKey: '' })
    const res = await postEvent(handler, abandonEvent(type), deps)
    const body = assertJson(res, 200)
    assert.equal(body.received, true)
    assert.equal(body.type, type)
    assert.deepEqual(body.released, { released: false, reason: 'no_service_role' })
    assert.deepEqual(calls, [])
  })

  for (const mode of RETRYABLE_REASONS) {
    test(`${type} returns 500 when release reason is ${mode}`, async () => {
      const sb = releaseClient(mode)
      const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE, client: sb })
      const res = await postEvent(handler, abandonEvent(type), deps)
      const body = assertJson(res, 500)
      assert.equal(body.received, true)
      assert.equal(body.type, type)
      assert.equal(body.released.released, false)
      assert.equal(body.released.reason, mode)
      assert.equal(typeof body.released.error, 'string')
      assert.deepEqual(calls, ['serviceClient'])
      if (mode === 'trip_unreadable') {
        assert.equal(sb.calls.length, 1)
        assert.equal(sb.calls[0].table, 'trips')
        assert.equal(sb.calls[0].terminal, 'maybeSingle')
      }
      if (mode === 'payments_unreadable') {
        assert.equal(sb.calls.some((call) => call.table === 'payments'), true)
        assert.equal(sb.calls.some((call) => call.op === 'rpc'), false)
      }
      if (mode === 'update_failed') {
        assert.equal(sb.calls.some((call) => call.op === 'rpc' && call.fn === 'merge_trip_metadata'), true)
      }
    })
  }

  test(`${type} with no trip id is 200 missing_trip`, async () => {
    const sb = releaseClient('update_failed')
    const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE, client: sb })
    const res = await postEvent(handler, abandonEvent(type, { kind: 'airport_deposit' }), deps)
    const body = assertJson(res, 200)
    assert.deepEqual(body.released, { released: false, reason: 'missing_trip' })
    assert.deepEqual(sb.calls, [])
    assert.deepEqual(calls, ['serviceClient'])
  })
}

function paidSession() {
  return {
    id: 'cs_paid_route',
    object: 'checkout.session',
    payment_status: 'unpaid',
    metadata: {
      tripId: 'trip_paid_route',
      riderId: 'rider_paid_route',
      kind: 'airport_deposit',
    },
  }
}

function completedEvent(type, session) {
  return {
    id: `evt_${type}`,
    object: 'event',
    type,
    data: { object: session },
  }
}

for (const spec of [
  { type: 'checkout.session.completed', asyncSucceeded: false },
  { type: 'checkout.session.async_payment_succeeded', asyncSucceeded: true },
]) {
  test(`${spec.type} passes the session and isAsyncPaymentSucceeded ${spec.asyncSucceeded} to applyPaidCheckoutSession`, async () => {
    const session = paidSession()
    const sb = { marker: `client-${spec.asyncSucceeded}` }
    const { calls, applied, deps } = routingDeps({ serviceKey: SERVICE_ROLE, client: sb })
    const res = await postEvent(handler, completedEvent(spec.type, session), deps)
    const body = assertJson(res, 200)
    assert.equal(applied.length, 1)
    assert.deepEqual(applied[0].session, session)
    assert.equal(applied[0].client, sb)
    assert.equal(applied[0].opts.isAsyncPaymentSucceeded, spec.asyncSucceeded)
    assert.equal(applied[0].opts.restoreLiveTripAfterDeposit, deps.restoreLiveTripAfterDeposit)
    assert.equal(applied[0].opts.grantRiderSocialForTrip, deps.grantRiderSocialForTrip)
    assert.deepEqual(body, {
      received: true,
      type: spec.type,
      recorded: { ok: true },
      live: { restored: false },
      referral: { ok: true, granted: false },
    })
    assert.deepEqual(calls, ['serviceClient', 'applyPaidCheckoutSession'])
  })
}

test('a throwing applyPaidCheckoutSession returns 400 and the handler settles', async () => {
  const { calls, deps } = routingDeps({
    serviceKey: SERVICE_ROLE,
    onApply() {
      throw new Error('apply blew up')
    },
  })
  const res = await postEvent(handler, completedEvent('checkout.session.completed', paidSession()), deps)
  const body = assertJson(res, 400)
  assert.equal(body.error, 'apply blew up')
  assert.equal(body.received, undefined)
  assert.deepEqual(calls, ['serviceClient', 'applyPaidCheckoutSession'])
})

test('a rejecting applyPaidCheckoutSession on async_payment_succeeded returns 400 and the handler settles', async () => {
  const { deps } = routingDeps({
    serviceKey: '',
    onApply() {
      return Promise.reject(new Error('apply rejected'))
    },
  })
  const res = await postEvent(
    handler,
    completedEvent('checkout.session.async_payment_succeeded', paidSession()),
    deps,
  )
  const body = assertJson(res, 400)
  assert.equal(body.error, 'apply rejected')
})

function tipEvent(metadata = {}) {
  return {
    id: 'evt_tip',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_tip_1',
        object: 'payment_intent',
        metadata: { ...metadata, kind: 'tip' },
      },
    },
  }
}

function creditEvent(type, metadata = {}) {
  return {
    id: 'evt_credit',
    object: 'event',
    type,
    data: {
      object: {
        id: 'cs_credit_1',
        object: 'checkout.session',
        metadata: { ...metadata, kind: 'credit_purchase' },
      },
    },
  }
}

// Import-time serviceKey is '' (env cleared before the first import). deps.serviceKey
// does not unlock recordTip / recordCreditPurchase, so complete metadata still
// returns no_service_role and the real serviceClient() is not reached.
const NO_SERVICE_ROLE_CASES = [
  { label: 'tip with rider and trip', event: tipEvent({ tripId: 'trip_tip', riderId: 'rider_tip' }), field: 'recorded' },
  { label: 'tip missing tripId', event: tipEvent({ riderId: 'rider_tip' }), field: 'recorded' },
  { label: 'tip missing riderId', event: tipEvent({ tripId: 'trip_tip' }), field: 'recorded' },
  { label: 'tip with blank ids', event: tipEvent({ tripId: '', riderId: '' }), field: 'recorded' },
  {
    label: 'credit_purchase completed with profile and pack',
    event: creditEvent('checkout.session.completed', { profile_id: 'profile_1', pack_id: 'pack_1' }),
    field: 'granted',
  },
  {
    label: 'credit_purchase async_payment_succeeded with profile and pack',
    event: creditEvent('checkout.session.async_payment_succeeded', { profile_id: 'profile_1', pack_id: 'pack_1' }),
    field: 'granted',
  },
  {
    label: 'credit_purchase completed missing profile_id',
    event: creditEvent('checkout.session.completed', { pack_id: 'pack_1' }),
    field: 'granted',
  },
  {
    label: 'credit_purchase completed missing pack_id',
    event: creditEvent('checkout.session.completed', { profile_id: 'profile_1' }),
    field: 'granted',
  },
]

for (const spec of NO_SERVICE_ROLE_CASES) {
  test(`${spec.label} returns skipped no_service_role and does not call serviceClient`, async () => {
    const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE })
    const res = await postEvent(handler, spec.event, deps)
    const body = assertJson(res, 200)
    assert.equal(body.received, true)
    assert.equal(body.type, spec.event.type)
    assert.deepEqual(body[spec.field], { skipped: true, reason: 'no_service_role' })
    assert.deepEqual(calls, [])
  })
}

// Same helpers on the instance evaluated with a fake service-role string.
// Incomplete metadata returns missing_metadata before serviceClient().
const MISSING_METADATA_CASES = [
  { label: 'tip missing tripId', event: tipEvent({ riderId: 'rider_tip' }), field: 'recorded' },
  { label: 'tip missing riderId', event: tipEvent({ tripId: 'trip_tip' }), field: 'recorded' },
  { label: 'tip with no ids', event: tipEvent(), field: 'recorded' },
  { label: 'tip with blank ids', event: tipEvent({ tripId: '', riderId: '' }), field: 'recorded' },
  {
    label: 'credit_purchase missing profile_id',
    event: creditEvent('checkout.session.completed', { pack_id: 'pack_1' }),
    field: 'granted',
  },
  {
    label: 'credit_purchase missing pack_id',
    event: creditEvent('checkout.session.completed', { profile_id: 'profile_1' }),
    field: 'granted',
  },
  {
    label: 'credit_purchase with blank ids',
    event: creditEvent('checkout.session.completed', { profile_id: '', pack_id: '' }),
    field: 'granted',
  },
  {
    label: 'credit_purchase async_payment_succeeded missing pack_id',
    event: creditEvent('checkout.session.async_payment_succeeded', { profile_id: 'profile_1' }),
    field: 'granted',
  },
]

for (const spec of MISSING_METADATA_CASES) {
  test(`${spec.label} returns skipped missing_metadata and does not construct a client`, async () => {
    const { calls, deps } = routingDeps({ serviceKey: '' })
    const res = await postEvent(handlerWithServiceKey, spec.event, deps)
    const body = assertJson(res, 200)
    assert.equal(body.received, true)
    assert.equal(body.type, spec.event.type)
    assert.deepEqual(body[spec.field], { skipped: true, reason: 'missing_metadata' })
    assert.deepEqual(calls, [])
  })
}

const UNKNOWN_EVENTS = [
  { type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge' } } },
  {
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_balance', object: 'payment_intent', metadata: { kind: 'balance', tripId: 'trip_x', riderId: 'rider_x' } } },
  },
  { type: 'payment_intent.canceled', data: { object: { id: 'pi_cancel', object: 'payment_intent' } } },
  { type: 'checkout.session.created', data: { object: { id: 'cs_created', object: 'checkout.session' } } },
  { type: 'invoice.paid', data: { object: { id: 'in_1', object: 'invoice' } } },
  { type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', object: 'subscription' } } },
  { type: 'sigma.scheduled_query_run.created' },
]

for (const event of UNKNOWN_EVENTS) {
  test(`unknown event ${event.type} returns 200 received and does not apply`, async () => {
    const { calls, deps } = routingDeps({ serviceKey: SERVICE_ROLE })
    const res = await postEvent(handler, { id: `evt_${event.type}`, object: 'event', ...event }, deps)
    const body = assertJson(res, 200)
    assert.deepEqual(body, { received: true, type: event.type })
    assert.deepEqual(calls, [])
  })
}
