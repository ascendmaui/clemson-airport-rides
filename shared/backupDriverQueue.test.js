import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKUP_CONFIRM_WINDOW_MS,
  BACKUP_WINDOW_CEILING_MS,
  BACKUP_WINDOW_FLOOR_MS,
  acceptBackupRole,
  backupBookingMetadata,
  confirmCountdownLabel,
  confirmWindowOpenLeadMs,
  releaseBackupSeat,
  driverStartedTowardPickup,
  earningsExtrasForDriver,
  preauthBaseCents,
  promoteBackup,
  readScheduledBoostCents,
  riderCaptureFareCents,
  splitBackupPayout,
} from './backupDriverQueue.js'

test('confirm window lead is drive time plus 10 minutes, clamped to 20–60', () => {
  assert.equal(confirmWindowOpenLeadMs(0), BACKUP_WINDOW_FLOOR_MS)
  assert.equal(confirmWindowOpenLeadMs(15 * 60 * 1000), 25 * 60 * 1000)
  assert.equal(confirmWindowOpenLeadMs(90 * 60 * 1000), BACKUP_WINDOW_CEILING_MS)
})

test('confirm countdown counts down to the close of the five-minute window', () => {
  const closes = '2026-10-10T14:55:00.000Z'
  assert.equal(confirmCountdownLabel(closes, Date.parse('2026-10-10T14:50:00.000Z')), '5:00 left')
  assert.equal(confirmCountdownLabel(closes, Date.parse('2026-10-10T14:54:30.500Z')), '0:30 left')
  assert.equal(confirmCountdownLabel(closes, Date.parse('2026-10-10T14:55:01.000Z')), '0:00 left')
  assert.equal(confirmCountdownLabel(null), null)
})

test('backup presets are only $10 and $15 and ride the existing pre-auth base', () => {
  assert.equal(backupBookingMetadata(1000).bonusCents, 1000)
  assert.equal(backupBookingMetadata(1500).bonusCents, 1500)
  assert.equal(backupBookingMetadata(2000), null)
  assert.equal(preauthBaseCents(6400, 1500), 7900)
  assert.equal(riderCaptureFareCents({ fare_cents: 6400, metadata: { backup_queue: backupBookingMetadata(1000) } }), 7400)
  assert.equal(riderCaptureFareCents({ fare_cents: 6400, metadata: {} }), 6400)
})

test('queue fills primary then one backup and rejects a third driver', () => {
  const booked = backupBookingMetadata(1000)
  const primary = acceptBackupRole(booked, 'driver-a')
  assert.equal(primary.role, 'primary')
  assert.equal(primary.queue.backupDriverId, null)
  const again = acceptBackupRole(primary.queue, 'driver-a')
  assert.equal(again.idempotent, true)
  const backup = acceptBackupRole(primary.queue, 'driver-b')
  assert.equal(backup.role, 'backup')
  const third = acceptBackupRole(backup.queue, 'driver-c')
  assert.equal(third.ok, false)
  assert.equal(third.code, 'queue_full')
})

test('movement requires a closer fix, or a navigate tap', () => {
  const pickup = { lat: 34.6834, lng: -82.8374 }
  assert.equal(driverStartedTowardPickup({
    pickup,
    previousFix: { lat: 34.70, lng: -82.90 },
    currentFix: { lat: 34.69, lng: -82.86 },
  }), true)
  assert.equal(driverStartedTowardPickup({
    pickup,
    previousFix: { lat: 34.6834, lng: -82.8374 },
    currentFix: { lat: 34.70, lng: -82.90 },
  }), false)
  assert.equal(driverStartedTowardPickup({ pickup, navigateStartedAt: '2026-10-10T15:00:00Z' }), true)
})

test('a backup who leaves reopens the seat without a strike', () => {
  const booked = acceptBackupRole(acceptBackupRole(backupBookingMetadata(1000), 'driver-a').queue, 'driver-b').queue
  const left = releaseBackupSeat(booked, 'driver-b', '2026-10-10T14:00:00.000Z')
  assert.equal(left.ok, true)
  assert.equal(left.queue.backupDriverId, null)
  assert.equal(left.queue.primaryDriverId, 'driver-a')
  assert.equal(left.queue.backupStoodBy, false)
  assert.equal(left.queue.strikes?.length || 0, 0)
  assert.equal(releaseBackupSeat(booked, 'driver-a').ok, false)
})

test('early cancel promotes the backup and reopens the seat', () => {
  const filled = acceptBackupRole(acceptBackupRole(backupBookingMetadata(1500), 'driver-a').queue, 'driver-b').queue
  const promoted = promoteBackup(filled, { reason: 'early_cancel', now: '2026-10-10T15:00:00.000Z' })
  assert.equal(promoted.primaryDriverId, 'driver-b')
  assert.equal(promoted.backupDriverId, null)
  assert.equal(promoted.confirmState, 'window_open')
  assert.equal(promoted.flakedDriverId, 'driver-a')
  assert.equal(Date.parse(promoted.windowClosesAt) - Date.parse(promoted.windowOpensAt), BACKUP_CONFIRM_WINDOW_MS)
})

test('payout is fare plus boost plus backup bonus only when that driver earned it', () => {
  assert.equal(readScheduledBoostCents({ scheduled_boost_cents: 500 }), 500)
  assert.equal(readScheduledBoostCents({ boost: { cents: 1000 } }), 1000)
  assert.equal(readScheduledBoostCents({ boost_included_in_driver_net: true, boost_cents: 1000 }), 0)
  const standby = splitBackupPayout({ fareNetCents: 8000, boostCents: 500, bonusCents: 1000, promoted: false, backupStoodBy: true })
  assert.deepEqual(standby, {
    completingDriverCents: 8500,
    standbyCents: 1000,
    flakedPrimaryCents: 0,
    strike: false,
  })
  const offline = splitBackupPayout({ fareNetCents: 8000, boostCents: 500, bonusCents: 1000, backupStoodBy: false })
  assert.equal(offline.standbyCents, 0)
  const promoted = splitBackupPayout({ fareNetCents: 8000, boostCents: 500, bonusCents: 1500, promoted: true })
  assert.equal(promoted.completingDriverCents, 10000)
  assert.equal(promoted.standbyCents, 0)
  assert.equal(promoted.flakedPrimaryCents, 0)
  assert.equal(promoted.strike, true)
  const trip = {
    driver_id: 'driver-b',
    metadata: {
      backup_queue: {
        ...promoteBackup(acceptBackupRole(acceptBackupRole(backupBookingMetadata(1500), 'driver-a').queue, 'driver-b').queue, { reason: 'no_confirm', now: '2026-10-10T15:00:00.000Z' }),
        primaryDriverId: 'driver-b',
      },
    },
  }
  assert.equal(earningsExtrasForDriver(trip, 'driver-b').cents, 1500)
  assert.equal(earningsExtrasForDriver({
    driver_id: 'driver-a',
    metadata: { backup_queue: acceptBackupRole(acceptBackupRole(backupBookingMetadata(1000), 'driver-a').queue, 'driver-b').queue },
  }, 'driver-b').cents, 1000)
  assert.equal(earningsExtrasForDriver({
    driver_id: 'driver-a',
    metadata: { backup_queue: acceptBackupRole(acceptBackupRole(backupBookingMetadata(1000), 'driver-a').queue, 'driver-b').queue },
  }, 'driver-a').cents, 0)
})
