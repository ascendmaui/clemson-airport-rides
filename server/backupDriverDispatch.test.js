import test from 'node:test'
import assert from 'node:assert/strict'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'
import { buildPayoutRecord } from './payouts.js'
import { releaseScheduledRides } from './releaseScheduledRides.js'
import {
  acceptBackupSlot,
  cancelBackupPrimary,
  releaseBackupDriver,
  runScheduledDispatchTick,
} from './backupDriverDispatch.js'
import tickHandler from './endpoints/scheduledDispatchTick.js'

const NOW = new Date('2026-10-10T15:00:00.000Z')
const PICKUP = '2026-10-10T16:00:00.000Z'

function queueTrip(queue, patch = {}) {
  const seeded = seedMatchingScenario({
    tripId: 'trip-backup-1',
    trip: {
      status: 'scheduled',
      driver_id: null,
      pickup_at: PICKUP,
      scheduled_for: PICKUP,
      deposit_cents: 0,
      fare_cents: 10000,
      metadata: { kind: 'scheduled', purpose: 'airport', backup_queue: queue },
      ...patch,
    },
  })
  return seeded.supabase
}

function tripOf(sb) {
  return sb._tables.trips[0]
}

test('queue fill keeps the ride in the scheduled pool until the backup seat is taken', async () => {
  const sb = queueTrip(backupBookingMetadata(1000, NOW))
  const primary = await acceptBackupSlot(sb, { tripId: 'trip-backup-1', driverId: 'driver-1', now: NOW })
  assert.equal(primary.role, 'primary')
  assert.equal(primary.lookingForBackup, true)
  assert.equal(tripOf(sb).status, 'scheduled')
  assert.equal(tripOf(sb).driver_id, null)
  const again = await acceptBackupSlot(sb, { tripId: 'trip-backup-1', driverId: 'driver-1', now: NOW })
  assert.equal(again.idempotent, true)
  const backup = await acceptBackupSlot(sb, { tripId: 'trip-backup-1', driverId: 'driver-2', now: NOW })
  assert.equal(backup.role, 'backup')
  assert.equal(backup.lookingForBackup, false)
  const third = await acceptBackupSlot(sb, { tripId: 'trip-backup-1', driverId: 'driver-3', now: NOW })
  assert.equal(third.ok, false)
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-1')
  assert.equal(tripOf(sb).metadata.backup_queue.backupDriverId, 'driver-2')
})

test('missed confirm releases the ride to the backup and a second tick does not promote again', async () => {
  const queue = {
    ...backupBookingMetadata(1500, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    confirmState: 'window_open',
    windowOpensAt: '2026-10-10T14:50:00.000Z',
    windowClosesAt: '2026-10-10T14:55:00.000Z',
    generation: 3,
  }
  const sb = queueTrip(queue)
  const first = await runScheduledDispatchTick(sb, { now: NOW })
  assert.equal(first.promoted, 1)
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-2')
  assert.equal(tripOf(sb).metadata.backup_queue.backupDriverId, null)
  assert.equal(tripOf(sb).metadata.backup_queue.flakedDriverId, 'driver-1')
  assert.equal(tripOf(sb).status, 'scheduled')
  assert.equal(sb._tables.driver_reliability_strikes.length, 1)
  assert.equal(sb._tables.driver_reliability_strikes[0].reason, 'no_confirm')
  const second = await runScheduledDispatchTick(sb, { now: NOW })
  assert.equal(second.promoted, 0)
  assert.equal(second.pooled, 0)
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-2')
})

test('confirmed driver who does not start toward pickup is released for no movement', async () => {
  const queue = {
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    confirmState: 'window_open',
    confirmedAt: '2026-10-10T14:50:00.000Z',
    windowOpensAt: '2026-10-10T14:50:00.000Z',
    windowClosesAt: '2026-10-10T14:55:00.000Z',
    lastFix: { lat: 34.68, lng: -82.84 },
    generation: 4,
  }
  const sb = queueTrip(queue)
  const summary = await runScheduledDispatchTick(sb, { now: NOW })
  assert.equal(summary.promoted, 1)
  assert.equal(tripOf(sb).metadata.backup_queue.events.at(-1).reason, 'no_movement')
  assert.equal(sb._tables.driver_reliability_strikes[0].reason, 'no_movement')
})

test('early cancel promotes the backup and reopens the backup seat', async () => {
  const queue = {
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    generation: 4,
  }
  const sb = queueTrip(queue)
  const result = await cancelBackupPrimary(sb, { tripId: 'trip-backup-1', driverId: 'driver-1', now: NOW })
  assert.equal(result.action, 'promote')
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-2')
  assert.equal(tripOf(sb).metadata.backup_queue.backupDriverId, null)
  assert.equal(tripOf(sb).metadata.backup_queue.confirmState, 'window_open')
  assert.equal(sb._tables.driver_reliability_strikes[0].reason, 'early_cancel')
})

test('backup driver leaving reopens the backup seat and does not strike anyone', async () => {
  const queue = {
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    generation: 4,
  }
  const sb = queueTrip(queue)
  const result = await releaseBackupDriver(sb, { tripId: 'trip-backup-1', driverId: 'driver-2', now: NOW })
  assert.equal(result.action, 'released')
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-1')
  assert.equal(tripOf(sb).metadata.backup_queue.backupDriverId, null)
  assert.equal((sb._tables.driver_reliability_strikes || []).length, 0)
})

test('no backup reopens the live pool and notifies rider and admin', async () => {
  const queue = {
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    confirmState: 'window_open',
    windowOpensAt: '2026-10-10T14:50:00.000Z',
    windowClosesAt: '2026-10-10T14:55:00.000Z',
    generation: 2,
  }
  const sb = queueTrip(queue)
  sb._tables.profiles[0].expo_push_token = 'ExponentPushToken[rider]'
  const summary = await runScheduledDispatchTick(sb, { now: NOW })
  assert.equal(summary.pooled, 1)
  assert.equal(tripOf(sb).status, 'searching')
  assert.equal(tripOf(sb).driver_id, null)
  assert.equal(tripOf(sb).metadata.urgent_backup_release, true)
  assert.equal(tripOf(sb).metadata.scheduled_pickup_at, PICKUP)
  assert.equal(sb._tables.admin_notifications.length, 1)
  assert.equal(sb._tables.driver_reliability_strikes[0].driver_id, 'driver-1')
  const again = await runScheduledDispatchTick(sb, { now: NOW })
  assert.equal(again.pooled, 0)
})

test('a stale metadata snapshot cannot release the same ride twice', async () => {
  const queue = {
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    confirmState: 'window_open',
    windowOpensAt: '2026-10-10T14:50:00.000Z',
    windowClosesAt: '2026-10-10T14:55:00.000Z',
    generation: 2,
  }
  const sb = queueTrip(queue)
  const from = sb.from.bind(sb)
  sb.from = (table) => {
    if (table === 'driver_status') {
      sb._tables.trips[0].metadata = { ...sb._tables.trips[0].metadata, raced: true }
    }
    return from(table)
  }
  const summary = await runScheduledDispatchTick(sb, { now: NOW })
  assert.equal(summary.raced >= 1, true)
  assert.equal(summary.promoted, 0)
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-1')
})

test('backup rides stay out of the 45-minute release, and payout adds boost plus bonus', async () => {
  const sb = queueTrip({
    ...backupBookingMetadata(1500, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    promotedFromBackup: true,
  })
  const released = await releaseScheduledRides(sb, { now: new Date('2026-10-10T15:20:00.000Z'), alertDriver: async () => {} })
  assert.equal(released.released, 0)
  assert.equal(released.held, 1)
  assert.equal(tripOf(sb).status, 'scheduled')
  const record = buildPayoutRecord({
    id: 'trip-backup-1',
    driver_id: 'driver-2',
    fare_cents: 10000,
    metadata: {
      driver_net_cents: 7500,
      scheduled_boost_cents: 1000,
      backup_queue: tripOf(sb).metadata.backup_queue,
    },
  })
  assert.equal(record.amountCents, 7500 + 1000 + 1500)
})

test('dispatch tick requires the cron bearer and is safe to call twice', async () => {
  const denied = await invokeTick({ headers: {} })
  assert.equal(denied.status, 401)
  const sb = queueTrip({
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    confirmState: 'window_open',
    windowOpensAt: '2026-10-10T14:50:00.000Z',
    windowClosesAt: '2026-10-10T14:55:00.000Z',
    generation: 2,
  })
  const first = await invokeTick({ sb, headers: { authorization: 'Bearer test-cron' } })
  const second = await invokeTick({ sb, headers: { authorization: 'Bearer test-cron' } })
  assert.equal(first.status, 200)
  assert.equal(first.body.promoted, 1)
  assert.equal(second.status, 200)
  assert.equal(second.body.promoted, 0)
})

async function invokeTick({ headers, sb }) {
  const res = { statusCode: 0, body: '', setHeader() {}, get writableEnded() { return false } }
  res.end = () => {}
  const jsonBody = () => {
    try { return JSON.parse(res.body) } catch { return null }
  }
  const original = res
  original.write = undefined
  const wrapped = {
    statusCode: 200,
    setHeader() {},
    get writableEnded() { return false },
    end(payload) { wrapped.body = payload },
  }
  await tickHandler({
    method: 'POST',
    url: '/api/scheduled-dispatch-tick',
    headers,
  }, wrapped, {
    sb: sb || queueTrip(backupBookingMetadata(1000, NOW)),
    env: { CRON_SECRET: 'test-cron' },
    now: NOW,
  })
  return { status: wrapped.statusCode, body: jsonBody.call({ body: wrapped.body }) || JSON.parse(wrapped.body || '{}') }
}
