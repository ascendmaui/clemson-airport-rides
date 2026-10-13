import test from 'node:test'
import assert from 'node:assert/strict'
import handleTripStatus from './endpoints/tripStatus.js'
import { DRIVER_END_REASONS, DRIVER_END_STATUSES } from '../shared/driverEndTrip.js'
import { fakeStripe, seedHold } from '../tests/fixtures/cancelFareHolds.js'

const at = '2026-10-13T18:00:00.000Z'

function ride(status = 'in_progress', patch = {}) {
  const { sb, trip } = seedHold('requires_capture', { status, ...patch })
  return { sb, trip }
}

async function request(sb, body = {}, extra = {}) {
  const res = { statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value) } }
  const stripe = extra.stripe || fakeStripe()
  await handleTripStatus({
    method: 'POST',
    url: '/api/driver?action=trip-status',
    headers: {},
    body: { tripId: 'trip-1', op: 'end-trip', reason: 'rider_unresponsive', ...body },
  }, res, { sb, user: { id: 'driver-1' }, now: at, stripe, ...extra, stripe })
  return res
}

test('only the assigned driver can end an active trip, and the fare is not captured', async () => {
  for (const id of ['rider-1', 'stranger']) {
    const { sb, trip } = ride('in_progress')
    const stripe = fakeStripe()
    stripe.paymentIntents.capture = async () => { throw new Error('must not capture') }
    const res = await request(sb, {}, { user: { id }, stripe })
    assert.equal(res.statusCode, 403, id)
    assert.equal(trip.status, 'in_progress')
    assert.equal(stripe.calls.length, 0)
  }
  assert.equal((await request(ride().sb, {}, { user: null })).statusCode, 401)

  for (const status of ['searching', 'offered', 'completed', 'canceled', 'scheduled']) {
    const { sb, trip } = ride(status)
    const res = await request(sb, {})
    assert.equal(res.statusCode, status === 'canceled' ? 200 : 409, status)
    if (status !== 'canceled') assert.equal(trip.status, status)
    if (status === 'canceled') assert.equal(res.body.idempotent, true)
  }

  for (const status of DRIVER_END_STATUSES) {
    const { sb, trip } = ride(status, status === 'accepted' ? { pickup_at: at, scheduled_for: at } : {})
    const stripe = fakeStripe()
    stripe.paymentIntents.capture = async () => { throw new Error('must not capture') }
    const res = await request(sb, { reason: 'safety' }, { stripe })
    assert.equal(res.statusCode, 200, status)
    assert.equal(res.body.charged, false)
    assert.equal(trip.status, 'canceled')
    assert.equal(trip.payment_status, 'no_charge')
    assert.equal(trip.metadata.cancel_reason, 'driver_end')
    assert.equal(trip.metadata.driver_end.reason, 'safety')
    assert.equal(trip.metadata.driver_end.from_status, status)
    assert.equal(trip.metadata.fare_authorization.status, 'canceled')
    assert.equal(stripe.calls.some((call) => call.op === 'capture'), false)
    assert.equal(stripe.calls.some((call) => call.op === 'cancel'), true)
    const again = await request(sb, { reason: 'safety' }, { stripe })
    assert.equal(again.statusCode, 200)
    assert.equal(again.body.idempotent, true)
    assert.equal(stripe.calls.filter((call) => call.op === 'cancel').length, 1)
  }
})

test('end trip validates the problem report before any write', async () => {
  for (const body of [{ reason: 'bogus' }, { reason: null }, { reason: 'other' }, { reason: 'other', note: '   ' }, { reason: 'other', note: 'a'.repeat(201) }]) {
    const { sb, trip } = ride('arrived')
    const res = await request(sb, body)
    assert.equal(res.statusCode, 400)
    assert.equal(trip.status, 'arrived')
  }
  for (const reason of DRIVER_END_REASONS) {
    const { sb } = ride('arrived')
    const stripe = fakeStripe()
    const res = await request(sb, { reason: reason.id, ...(reason.id === 'other' ? { note: 'Phone died' } : {}) }, { stripe })
    assert.equal(res.statusCode, 200, reason.id)
    assert.equal(stripe.calls.some((call) => call.op === 'capture'), false)
  }
})

test('heartbeats are limited to the rider or driver on an active trip and do not change status', async () => {
  const { sb, trip } = ride('in_progress')
  const driver = await request(sb, { op: 'heartbeat', reason: undefined })
  assert.equal(driver.statusCode, 200)
  assert.equal(trip.driver_heartbeat_at, at)
  assert.equal(trip.rider_heartbeat_at, undefined)
  assert.equal(trip.status, 'in_progress')
  const rider = await request(sb, { op: 'heartbeat' }, { user: { id: 'rider-1' } })
  assert.equal(rider.statusCode, 200)
  assert.equal(trip.rider_heartbeat_at, at)
  assert.equal(trip.status, 'in_progress')
  const stranger = await request(sb, { op: 'heartbeat' }, { user: { id: 'stranger' } })
  assert.equal(stranger.statusCode, 403)
  const done = ride('completed')
  assert.equal((await request(done.sb, { op: 'heartbeat' })).statusCode, 409)
  assert.equal(done.trip.status, 'completed')
})
