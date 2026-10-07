import test from 'node:test'
import assert from 'node:assert/strict'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'
import { cancelBackupRide, switchBackupDriver } from './backupRiderActions.js'

const NOW = new Date('2026-10-10T15:00:00.000Z')

function filledQueue(patch = {}) {
  return {
    ...backupBookingMetadata(1000, NOW),
    primaryDriverId: 'driver-1',
    backupDriverId: 'driver-2',
    primaryCard: { id: 'driver-1', name: 'Avery', vehicleLabel: 'Orange Honda', ratingAvg: 4.9, ratingCount: 12 },
    backupCard: { id: 'driver-2', name: 'Blair', vehicleLabel: 'White Tesla', ratingAvg: 5, ratingCount: 4 },
    generation: 4,
    ...patch,
  }
}

function ride(queue, patch = {}) {
  const seeded = seedMatchingScenario({
    tripId: 'trip-backup-1',
    trip: {
      status: 'scheduled',
      driver_id: null,
      pickup_at: '2026-10-10T16:00:00.000Z',
      fare_cents: 8000,
      metadata: {
        kind: 'scheduled',
        scheduled_boost_cents: 2000,
        backup_queue: queue,
      },
      ...patch,
    },
  })
  return seeded.supabase
}

function tripOf(sb) {
  return sb._tables.trips[0]
}

test('switch swaps the drivers, redirects the fee once, and a second switch is refused', async () => {
  const sb = ride(filledQueue())
  const first = await switchBackupDriver(sb, { tripId: 'trip-backup-1', riderId: 'rider-1', now: NOW })
  assert.equal(first.ok, true)
  assert.equal(first.formerPrimaryId, 'driver-1')
  assert.equal(first.newPrimaryId, 'driver-2')
  assert.equal(first.feeLabel, 'Switch fee')
  const queue = tripOf(sb).metadata.backup_queue
  assert.equal(queue.primaryDriverId, 'driver-2')
  assert.equal(queue.backupDriverId, 'driver-1')
  assert.equal(queue.switchFeeCents, 1000)
  assert.equal(queue.backupStoodBy, false)
  assert.equal(queue.strikes?.length || 0, 0)
  assert.equal((sb._tables.driver_reliability_strikes || []).length, 0)
  assert.equal(sb._tables.trip_events.some((event) => event.kind === 'rider_switch'), true)
  const second = await switchBackupDriver(sb, { tripId: 'trip-backup-1', riderId: 'rider-1', now: NOW })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'switch_limit')
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-2')
})

test('a driver already moving blocks the switch unless the rider files a safety report', async () => {
  const sb = ride(filledQueue({
    confirmState: 'enroute',
    navigateStartedAt: '2026-10-10T14:50:00.000Z',
  }), { status: 'accepted', driver_id: 'driver-1' })
  const blocked = await switchBackupDriver(sb, { tripId: 'trip-backup-1', riderId: 'rider-1', now: NOW })
  assert.equal(blocked.code, 'already_enroute')
  assert.equal(tripOf(sb).metadata.backup_queue.primaryDriverId, 'driver-1')
  const safety = await switchBackupDriver(sb, {
    tripId: 'trip-backup-1',
    riderId: 'rider-1',
    safetyReport: true,
    now: NOW,
  })
  assert.equal(safety.ok, true)
  assert.equal(tripOf(sb).driver_id, null)
  assert.equal(tripOf(sb).status, 'scheduled')
  assert.equal(tripOf(sb).metadata.backup_queue.events.at(-1).safetyReport, true)
})

test('cancel partial-captures the backup fee, refunds boost, and a second cancel does not capture again', async () => {
  const sb = ride(filledQueue())
  const captures = []
  const settle = async ({ finalFareCents }) => {
    captures.push(finalFareCents)
    return { ok: true, amountCents: finalFareCents, method: 'card' }
  }
  const first = await cancelBackupRide(sb, { tripId: 'trip-backup-1', riderId: 'rider-1', now: NOW, settle, stripe: null })
  assert.equal(first.ok, true)
  assert.deepEqual(captures, [1000])
  assert.equal(first.boostRefunded, true)
  assert.equal(first.backupPayoutCents, 0)
  assert.equal(first.feeDriverId, 'driver-1')
  assert.equal(tripOf(sb).status, 'canceled')
  assert.equal(tripOf(sb).metadata.backup_queue.cancelFeeCents, 1000)
  assert.equal(sb._tables.trip_events.some((event) => event.kind === 'rider_cancel' && event.payload.boostRefunded === true), true)
  const second = await cancelBackupRide(sb, { tripId: 'trip-backup-1', riderId: 'rider-1', now: NOW, settle, stripe: null })
  assert.equal(second.idempotent, true)
  assert.deepEqual(captures, [1000])
})

test('a scheduled ride with no backup keeps the existing cancel path', async () => {
  const sb = ride(null, { metadata: { kind: 'scheduled' } })
  const settle = async () => {
    throw new Error('no backup ride should not capture')
  }
  const result = await cancelBackupRide(sb, { tripId: 'trip-backup-1', riderId: 'rider-1', now: NOW, settle })
  assert.equal(result.useExistingCancel, true)
  assert.equal(tripOf(sb).status, 'scheduled')
})
