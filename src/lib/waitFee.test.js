import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_CANCEL_MS,
  CANCEL_AVAILABLE_MS,
  GRACE_MS,
  quoteWait,
  settleWait,
  waitFeeCentsFromElapsed,
} from './waitFee.js'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')

test('grace is free through 3:00', () => {
  assert.equal(waitFeeCentsFromElapsed(0), 0)
  assert.equal(waitFeeCentsFromElapsed(GRACE_MS), 0)
  assert.equal(waitFeeCentsFromElapsed(GRACE_MS - 1), 0)
  const q = quoteWait(new Date(T0).toISOString(), T0 + GRACE_MS)
  assert.equal(q.inGrace, true)
  assert.equal(q.waitFeeCents, 0)
  assert.equal(q.cancelAvailable, false)
})

test('first fraction after grace ceils to $1', () => {
  assert.equal(waitFeeCentsFromElapsed(GRACE_MS + 1), 100)
  assert.equal(waitFeeCentsFromElapsed(GRACE_MS + 60 * 1000), 100)
  assert.equal(waitFeeCentsFromElapsed(GRACE_MS + 60 * 1000 + 1), 200)
})

test('5:00 is $2 and cancel is available but not forced', () => {
  const q = quoteWait(new Date(T0).toISOString(), T0 + CANCEL_AVAILABLE_MS)
  assert.equal(q.waitFeeCents, 200)
  assert.equal(q.cancelAvailable, true)
  assert.equal(q.autoDue, false)
  assert.equal(q.clock, '5:00')
  const justBefore = quoteWait(new Date(T0).toISOString(), T0 + CANCEL_AVAILABLE_MS - 1)
  assert.equal(justBefore.cancelAvailable, false)
  assert.equal(justBefore.waitFeeCents, 200)
})

test('7:00 auto-cancel split is $4 wait + $1 cancel', () => {
  const at = T0 + AUTO_CANCEL_MS
  const q = quoteWait(new Date(T0).toISOString(), at)
  assert.equal(q.autoDue, true)
  assert.equal(q.cancelAvailable, false)
  assert.equal(q.waitFeeCents, 400)
  assert.equal(q.clock, '7:00')

  const settled = settleWait(AUTO_CANCEL_MS, 'auto')
  assert.deepEqual(settled, {
    reason: 'auto',
    waitFeeCents: 400,
    cancelFeeCents: 100,
    platformFeeCents: 100,
    riderChargeCents: 500,
    driverEarningsCents: 400,
  })
})

test('late auto-cancel still caps the wait fee at $4', () => {
  assert.equal(waitFeeCentsFromElapsed(AUTO_CANCEL_MS + 30 * 1000), 400)
  assert.equal(settleWait(AUTO_CANCEL_MS + 90 * 1000, 'auto').riderChargeCents, 500)
  assert.equal(settleWait(AUTO_CANCEL_MS + 90 * 1000, 'auto').driverEarningsCents, 400)
})

test('optional driver cancel is 20% platform / 80% driver on the wait fee', () => {
  const atFive = settleWait(CANCEL_AVAILABLE_MS, 'driver')
  assert.equal(atFive.waitFeeCents, 200)
  assert.equal(atFive.cancelFeeCents, 0)
  assert.equal(atFive.platformFeeCents, 40)
  assert.equal(atFive.riderChargeCents, 200)
  assert.equal(atFive.driverEarningsCents, 160)

  const atSixThirty = settleWait(6.5 * 60 * 1000, 'driver')
  assert.equal(atSixThirty.waitFeeCents, 400)
  assert.equal(atSixThirty.platformFeeCents, 80)
  assert.equal(atSixThirty.riderChargeCents, 400)
  assert.equal(atSixThirty.driverEarningsCents, 320)
})

test('completed trip wait fee is 20% platform / 80% driver', () => {
  const done = settleWait(GRACE_MS + 90 * 1000, 'complete')
  assert.equal(done.waitFeeCents, 200)
  assert.equal(done.cancelFeeCents, 0)
  assert.equal(done.platformFeeCents, 40)
  assert.equal(done.riderChargeCents, 200)
  assert.equal(done.driverEarningsCents, 160)
})
