import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  backOnlineMoment, chatMessageMoment, driverTipMoment, paymentFailedMoment, riderTripMoment, riderTripSnapshot,
} from '../packages/rides-native/rideMoments.js'

const trip = (over = {}) => ({ id: 't1', status: 'arriving', pickup_label: 'Core Campus', dropoff_label: 'GSP', metadata: {}, ...over })

test('rider: arrived and completed fire once per transition', () => {
  const prev = riderTripSnapshot(trip())
  const arrived = riderTripMoment(prev, trip({ status: 'arrived' }))
  assert.equal(arrived.cue, 'arrived')
  assert.equal(arrived.title, 'Your driver is here')
  assert.equal(riderTripMoment(riderTripSnapshot(trip({ status: 'arrived' })), trip({ status: 'arrived' })), null)
  const done = riderTripMoment(riderTripSnapshot(trip({ status: 'in_progress' })), trip({ status: 'completed' }))
  assert.equal(done.cue, 'complete')
  assert.equal(riderTripMoment(null, trip({ status: 'completed' })), null, 'first sight never toasts')
})

test('rider: a new driver_cancels entry is a driver-canceled warning', () => {
  const prev = riderTripSnapshot(trip({ status: 'accepted' }))
  const m = riderTripMoment(prev, trip({ status: 'searching', metadata: { driver_cancels: [{ driver_id: 'd' }] } }))
  assert.equal(m.cue, 'canceled')
  assert.equal(m.tone, 'warning')
  assert.match(m.body, /another driver/)
})

test('fare hold failed fires once for rider and driver copy', () => {
  const failed = trip({ metadata: { fare_authorization: { status: 'failed', amountCents: 2450 } } })
  assert.equal(paymentFailedMoment(undefined, failed), null)
  const rider = paymentFailedMoment(null, failed)
  assert.equal(rider.tone, 'error')
  assert.match(rider.body, /\$24\.50/)
  assert.equal(paymentFailedMoment('failed', failed), null)
  assert.equal(paymentFailedMoment(null, failed, 'driver').title, 'Rider payment hold failed')
  assert.equal(paymentFailedMoment(null, trip({ metadata: { fare_authorization: { status: 'requires_capture' } } })), null)
})

test('driver tip, chat, and back-online moments', () => {
  assert.equal(driverTipMoment(null, trip({ tip_cents: 300 })), null)
  assert.equal(driverTipMoment(0, trip({ tip_cents: 300 })).title, 'Tip received · $3.00')
  assert.equal(driverTipMoment(300, trip({ tip_cents: 300 })), null)
  assert.equal(chatMessageMoment({ id: 'm', sender_id: 'me', body: 'hi' }, 'me'), null)
  assert.equal(chatMessageMoment({ id: 'm', sender_id: 'r', trip_id: 't1', body: 'hi' }, 'me', { viewingTripId: 't1' }), null)
  assert.equal(chatMessageMoment({ id: 'm', sender_id: 'r', trip_id: 't1', body: 'at door 3' }, 'me').body, 'at door 3')
  assert.equal(backOnlineMoment(0), null)
  assert.equal(backOnlineMoment(2).body, '2 taps sent.')
  assert.equal(backOnlineMoment(1).body, '1 tap sent.')
})

test('RiderMoments is mounted, primes before toasting, and maps each cue', () => {
  const src = readFileSync(new URL('../apps/rider/components/RiderMoments.tsx', import.meta.url), 'utf8')
  assert.match(src, /if \(!primed \|\| !prev\) return/)
  assert.match(src, /case 'arrived':\s*void successHaptic\(\)\s*void playApproachPing\(\)/)
  assert.match(src, /case 'complete':\s*void successHaptic\(\)\s*void playCompleteCue\(\)/)
  assert.match(src, /case 'canceled':\s*void warningHaptic\(\)/)
  assert.match(src, /if \(!\(await hapticsEnabled\(\)\)\) return\s*Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Error\)/)
  assert.match(src, /showToast\(\{/)
  const layout = readFileSync(new URL('../apps/rider/app/_layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /<RiderMoments \/>/)
})
