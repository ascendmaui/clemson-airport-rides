import test from 'node:test'
import assert from 'node:assert/strict'
import { RIDER_ENROUTE_COPY } from '../backupDriverQueue.js'
import {
  scheduledRidesGuide,
  scheduledRidesTopic,
} from './scheduledRides.js'

const BANNED = /\b(pre-auth|preauth|queue depth|idempotent)\b/i

function walk(value, hits) {
  if (typeof value === 'string') {
    if (BANNED.test(value)) hits.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, hits))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => walk(item, hits))
  }
}

test('scheduled ride copy stays in plain words and covers each decision', () => {
  const rider = scheduledRidesGuide('rider')
  const driver = scheduledRidesGuide('driver')
  const hits = []
  walk(rider, hits)
  walk(driver, hits)
  assert.deepEqual(hits, [])
  assert.ok(rider.summary.length >= 8)
  assert.ok(driver.summary.length >= 8)
  assert.match(rider.summary.join(' '), /second driver in line/)
  assert.match(rider.summary.join(' '), /hold on your card/)
  assert.match(driver.summary.join(' '), /5 minutes/)
  assert.match(driver.summary.join(' '), /Leave now/)
  assert.match(rider.summary.join(' '), /never counts as a strike/)
  assert.match(rider.summary.join(' '), /gets nothing/)
  assert.match(scheduledRidesTopic('leave').steps.join(' '), new RegExp(RIDER_ENROUTE_COPY.replace(/[.]/g, '\\.')))
  assert.equal(scheduledRidesTopic('booking').helper.length > 20, true)
  assert.equal(scheduledRidesTopic('offer').steps[0].includes('Looking for backup driver'), true)
  assert.throws(() => scheduledRidesGuide('admin'), /Unexpected scheduled rides role/)
  assert.throws(() => scheduledRidesTopic('depth'), /Unexpected scheduled rides topic/)
})
