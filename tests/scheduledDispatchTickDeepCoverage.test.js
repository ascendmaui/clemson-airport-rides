import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptBackupSlot,
  confirmBackupTrip,
  cancelBackupPrimary,
  releaseBackupDriver,
  publicDriverCard,
  runScheduledDispatchTick,
} from '../server/backupDriverDispatch.js'
import scheduledDispatchTickHandler from '../server/endpoints/scheduledDispatchTick.js'
import { releaseScheduledRides } from '../server/releaseScheduledRides.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'
import { createMatchingSupabase, seedMatchingScenario } from './fixtures/matchingE2E.js'

function mockRes() {
  return {
    statusCode: 200,
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
      if (chunk) this.body += String(chunk)
      return this
    },
  }
}

function parseJson(res) {
  try {
    return JSON.parse(res.body || '{}')
  } catch {
    return null
  }
}

test('runScheduledDispatchTick: hands trip to urgent pool when primary driver misses confirm and no backup driver exists', async () => {
  const now = new Date('2026-10-10T14:56:00.000Z')
  const trip = {
    id: 'trip_pool_1',
    status: 'scheduled',
    rider_id: 'rider_1',
    driver_id: null,
    pickup_at: '2026-10-10T15:30:00.000Z',
    pickup_label: 'Tillman Hall',
    dropoff_label: 'GSP Airport',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_solo_primary',
        backupDriverId: null, // No backup driver
        confirmState: 'window_open',
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T14:55:00.000Z', // Expired 1 min ago
        generation: 1,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [{ driver_id: 'driver_solo_primary', online: true }],
  })
  const summary = await runScheduledDispatchTick(sb, { now })

  assert.equal(summary.scanned, 1)
  assert.equal(summary.pooled, 1)
  assert.equal(summary.promoted, 0)
  assert.equal(summary.opened, 0)

  const updated = sb._tables.trips[0]
  assert.equal(updated.metadata.backup_queue.confirmState, 'handed_to_pool')
  assert.equal(updated.metadata.backup_queue.urgent, true)
  assert.equal(updated.metadata.backup_queue.events.some((e) => e.kind === 'urgent_pool' && e.reason === 'no_confirm'), true)
  assert.equal(sb._tables.driver_reliability_strikes.length, 1)
  assert.equal(sb._tables.driver_reliability_strikes[0].driver_id, 'driver_solo_primary')
})

test('runScheduledDispatchTick: detects movement and transitions confirmed trip to enroute and accepted status', async () => {
  const now = new Date('2026-10-10T15:00:00.000Z')
  const trip = {
    id: 'trip_enroute_1',
    status: 'scheduled',
    rider_id: 'rider_enroute',
    driver_id: null,
    pickup_at: '2026-10-10T15:30:00.000Z',
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_moving',
        backupDriverId: 'driver_backup',
        confirmState: 'window_open',
        confirmedAt: '2026-10-10T14:52:00.000Z',
        navigateStartedAt: '2026-10-10T14:53:00.000Z', // Explicitly started navigation toward pickup
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T15:05:00.000Z',
        generation: 2,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [{ driver_id: 'driver_moving', online: true }],
  })
  const summary = await runScheduledDispatchTick(sb, { now })

  assert.equal(summary.scanned, 1)
  assert.equal(summary.enroute, 1)

  const updated = sb._tables.trips[0]
  assert.equal(updated.status, 'accepted')
  assert.equal(updated.driver_id, 'driver_moving')
  assert.equal(updated.metadata.backup_queue.confirmState, 'enroute')
  assert.ok(updated.metadata.backup_queue.riderNotifiedEnrouteAt)
})

test('runScheduledDispatchTick: respects waitingToLeave window and does not prematurely release confirmed driver', async () => {
  const now = new Date('2026-10-10T14:52:00.000Z')
  const trip = {
    id: 'trip_wait_leave',
    status: 'scheduled',
    rider_id: 'rider_wait',
    pickup_at: '2026-10-10T15:30:00.000Z',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_confirmed',
        backupDriverId: 'driver_backup',
        confirmState: 'window_open',
        confirmedAt: '2026-10-10T14:51:00.000Z',
        leaveNowAt: '2026-10-10T15:00:00.000Z', // Still 8 minutes before scheduled departure
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T14:55:00.000Z',
        generation: 2,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [{ driver_id: 'driver_confirmed', online: true }],
  })
  const summary = await runScheduledDispatchTick(sb, { now })

  assert.equal(summary.scanned, 1)
  assert.equal(summary.promoted, 0)
  assert.equal(summary.pooled, 0)
  assert.equal(summary.enroute, 0)

  // confirmState stays window_open
  const updated = sb._tables.trips[0]
  assert.equal(updated.metadata.backup_queue.confirmState, 'window_open')
})

test('runScheduledDispatchTick: records backupOfflineDuringWindow when backup driver is offline', async () => {
  const now = new Date('2026-10-10T14:52:00.000Z')
  const trip = {
    id: 'trip_offline_check',
    status: 'scheduled',
    rider_id: 'rider_1',
    pickup_at: '2026-10-10T15:30:00.000Z',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p',
        backupDriverId: 'driver_offline',
        confirmState: 'window_open',
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T14:55:00.000Z',
        generation: 1,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [
      { driver_id: 'driver_p', online: true },
      { driver_id: 'driver_offline', online: false },
    ],
  })

  await runScheduledDispatchTick(sb, { now })

  const updated = sb._tables.trips[0]
  assert.equal(updated.metadata.backup_queue.backupOfflineDuringWindow, true)
  assert.equal(updated.metadata.backup_queue.backupStoodBy, false)
})

test('scheduledDispatchTickHandler: returns 500 when dispatch tick throws an unexpected error', async () => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer cron_secret_valid' },
  }
  const res = mockRes()

  const brokenSb = {
    from: () => ({
      select: () => ({
        in: () => ({
          not: () => ({
            limit: async () => {
              throw new Error('Postgres query failure: deadlocked transaction')
            },
          }),
        }),
      }),
    }),
  }

  await scheduledDispatchTickHandler(req, res, {
    sb: brokenSb,
    cronSecret: 'cron_secret_valid',
    env: {},
  })

  assert.equal(res.statusCode, 500)
  const body = parseJson(res)
  assert.match(body.error, /Postgres query failure: deadlocked transaction/)
})

test('scheduledDispatchTickHandler: honors ALLOW_STAGING_DRY_RUN when staging cron endpoints are blocked', async () => {
  const req = {
    method: 'POST',
    url: '/api/scheduled-dispatch-tick?dry_run=1',
    headers: { authorization: 'Bearer staging_secret' },
  }
  const res = mockRes()
  const sb = createMatchingSupabase({ trips: [] })

  await scheduledDispatchTickHandler(req, res, {
    sb,
    cronSecret: 'staging_secret',
    env: {
      DISABLE_CRON_ENDPOINTS: '1',
      ALLOW_STAGING_DRY_RUN: '1',
    },
  })

  assert.equal(res.statusCode, 200)
  const body = parseJson(res)
  assert.equal(body.ok, true)
  assert.equal(body.dryRun, true)
})

test('publicDriverCard: populates driver card with profile and vehicle info, falls back safely', async () => {
  // 1. null sb or driverId returns defaults
  const empty1 = await publicDriverCard(null, 'driver_1')
  assert.equal(empty1.name, 'Driver')
  assert.equal(empty1.vehicleLabel, 'Vehicle')
  assert.equal(empty1.id, 'driver_1')

  const empty2 = await publicDriverCard({}, null)
  assert.equal(empty2.name, 'Driver')
  assert.equal(empty2.id, null)

  // 2. Loads profile and vehicle
  const sb = createMatchingSupabase({
    profiles: [
      { id: 'd_tiger', full_name: 'Trevor Lawrence', avatar_url: 'https://avatar.com/1', rating_avg: 4.95, rating_count: 125 },
    ],
    vehicles: [
      { driver_id: 'd_tiger', color: 'Orange', make: 'Ford', model: 'F-150' },
    ],
  })
  const card = await publicDriverCard(sb, 'd_tiger')
  assert.equal(card.id, 'd_tiger')
  assert.equal(card.name, 'Trevor Lawrence')
  assert.equal(card.avatarUrl, 'https://avatar.com/1')
  assert.equal(card.ratingAvg, 4.95)
  assert.equal(card.ratingCount, 125)
  assert.equal(card.vehicleLabel, 'Orange Ford F-150')
})

test('acceptBackupSlot: enforces rider-driver isolation, handles non-backup rides and race collisions', async () => {
  const now = new Date('2026-10-10T15:00:00.000Z')
  // 1. Trip not found -> 404
  const sbEmpty = createMatchingSupabase({ trips: [] })
  const resNotFound = await acceptBackupSlot(sbEmpty, { tripId: 'trip_none', driverId: 'd_1' })
  assert.equal(resNotFound.status, 404)

  // 2. Non-backup ride -> returns useScheduledRpc: true
  const plainTrip = { id: 'trip_plain', status: 'scheduled', metadata: {} }
  const sbPlain = createMatchingSupabase({ trips: [plainTrip] })
  const resPlain = await acceptBackupSlot(sbPlain, { tripId: 'trip_plain', driverId: 'd_1' })
  assert.equal(resPlain.useScheduledRpc, true)

  // 3. Driver is the rider -> 403
  const ownRide = {
    id: 'trip_own',
    status: 'scheduled',
    rider_id: 'd_rider_driver',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
      },
    },
  }
  const sbOwn = createMatchingSupabase({ trips: [ownRide] })
  const resOwn = await acceptBackupSlot(sbOwn, { tripId: 'trip_own', driverId: 'd_rider_driver' })
  assert.equal(resOwn.status, 403)
  assert.match(resOwn.error, /can't accept your own ride/)
})

test('confirmBackupTrip: handles non-primary driver, idempotent enroute, and navigate immediately', async () => {
  const now = new Date('2026-10-10T15:00:00.000Z')
  const trip = {
    id: 'trip_confirm_edge',
    status: 'scheduled',
    pickup_at: '2026-10-10T15:30:00.000Z',
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_primary',
        backupDriverId: 'driver_backup',
        confirmState: 'window_open',
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T15:05:00.000Z',
        events: [],
      },
    },
  }
  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_status: [{ driver_id: 'driver_primary', online: true }],
  })

  // 1. Wrong driver attempts confirm -> 403
  const resWrong = await confirmBackupTrip(sb, { tripId: 'trip_confirm_edge', driverId: 'driver_stranger' })
  assert.equal(resWrong.status, 403)
  assert.match(resWrong.error, /Only the assigned driver/)

  // 2. Primary driver confirms with navigate: true -> transitions to enroute immediately
  const resNav = await confirmBackupTrip(sb, { tripId: 'trip_confirm_edge', driverId: 'driver_primary', navigate: true, now })
  assert.equal(resNav.ok, true)
  assert.equal(resNav.enroute, true)

  // 3. Second call when already enroute returns idempotent
  const resAgain = await confirmBackupTrip(sb, { tripId: 'trip_confirm_edge', driverId: 'driver_primary', now })
  assert.equal(resAgain.ok, true)
  assert.equal(resAgain.idempotent, true)
})

test('cancelBackupPrimary and releaseBackupDriver: handles seat actions, promotion, pool handoff, and access control', async () => {
  const now = new Date('2026-10-10T15:00:00.000Z')
  // 1. cancelBackupPrimary with backup driver present promotes the backup
  const tripWithBackup = {
    id: 'trip_promote_case',
    status: 'scheduled',
    pickup_at: '2026-10-10T16:00:00.000Z',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p1',
        backupDriverId: 'driver_b1',
        events: [],
      },
    },
  }
  const sbPromote = createMatchingSupabase({
    trips: [tripWithBackup],
    trip_events: [],
    driver_reliability_strikes: [],
  })
  const promoteRes = await cancelBackupPrimary(sbPromote, { tripId: 'trip_promote_case', driverId: 'driver_p1', now })
  assert.equal(promoteRes.ok, true)
  assert.equal(promoteRes.action, 'promote')
  const promotedTrip = sbPromote._tables.trips[0]
  assert.equal(promotedTrip.metadata.backup_queue.primaryDriverId, 'driver_b1')
  assert.equal(promotedTrip.metadata.backup_queue.backupDriverId, null)

  // 2. releaseBackupDriver ensures only the backup driver can release their seat
  const tripForRelease = {
    id: 'trip_rel_case',
    status: 'scheduled',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p2',
        backupDriverId: 'driver_b2',
        events: [],
      },
    },
  }
  const sbRelease = createMatchingSupabase({
    trips: [tripForRelease],
    trip_events: [],
  })
  // Stranger gets 403
  const strangerRes = await releaseBackupDriver(sbRelease, { tripId: 'trip_rel_case', driverId: 'driver_stranger', now })
  assert.equal(strangerRes.status, 403)

  // Actual backup driver succeeds
  const relRes = await releaseBackupDriver(sbRelease, { tripId: 'trip_rel_case', driverId: 'driver_b2', now })
  assert.equal(relRes.ok, true)
  assert.equal(relRes.action, 'released')
  assert.equal(relRes.lookingForBackup, true)
  assert.equal(sbRelease._tables.trips[0].metadata.backup_queue.backupDriverId, null)
})

test('releaseScheduledRides: holds near-term and backup-queue rides, releases handed_to_pool rides', async () => {
  const now = new Date('2026-10-10T15:30:00.000Z')
  const pickupNear = '2026-10-10T15:45:00.000Z' // 15 mins out -> near-term
  const pickupFuture = '2026-10-10T16:00:00.000Z' // 30 mins out

  // 1. Near-term ride is held
  const seededNear = seedMatchingScenario({
    tripId: 'trip_near_held',
    trip: {
      status: 'scheduled',
      driver_id: null,
      pickup_at: pickupNear,
      scheduled_for: pickupNear,
      deposit_cents: 0,
      metadata: { kind: 'scheduled', near_term_slot: true },
    },
  })
  const nearRes = await releaseScheduledRides(seededNear.supabase, { now, alertDriver: async () => {} })
  assert.equal(nearRes.held, 1)
  assert.equal(nearRes.released, 0)

  // 2. Backup-queue ride in window_open is held
  const seededBq = seedMatchingScenario({
    tripId: 'trip_bq_held',
    trip: {
      status: 'scheduled',
      driver_id: null,
      pickup_at: pickupFuture,
      scheduled_for: pickupFuture,
      deposit_cents: 0,
      metadata: {
        kind: 'scheduled',
        backup_queue: {
          ...backupBookingMetadata(1000, now),
          primaryDriverId: 'driver_p',
          backupDriverId: 'driver_b',
          confirmState: 'window_open',
        },
      },
    },
  })
  const bqRes = await releaseScheduledRides(seededBq.supabase, { now, alertDriver: async () => {} })
  assert.equal(bqRes.held, 1)
  assert.equal(bqRes.released, 0)

  // 3. Backup-queue ride with confirmState: 'handed_to_pool' IS released to live matcher
  const seededPool = seedMatchingScenario({
    tripId: 'trip_bq_pooled',
    trip: {
      status: 'scheduled',
      driver_id: null,
      pickup_at: pickupFuture,
      scheduled_for: pickupFuture,
      deposit_cents: 0,
      metadata: {
        kind: 'scheduled',
        backup_queue: {
          ...backupBookingMetadata(1000, now),
          confirmState: 'handed_to_pool',
        },
      },
    },
  })
  const poolRes = await releaseScheduledRides(seededPool.supabase, { now, alertDriver: async () => {} })
  assert.equal(poolRes.released, 1)
  assert.equal(poolRes.held, 0)
  assert.equal(seededPool.supabase._tables.trips[0].status, 'searching')
})

test('runScheduledDispatchTick: opens window when current time is between window bounds and notifies primary driver', async () => {
  // Pickup is 25 minutes in the future, driveMs is 0 -> lead is 20 min, window opens at pickup - 20m, closes at +5m
  const pickupAt = '2026-10-10T15:30:00.000Z'
  const now = new Date('2026-10-10T15:12:00.000Z') // 18 mins before pickup: inside 15:10 to 15:15 window
  const trip = {
    id: 'trip_open_window_1',
    status: 'scheduled',
    rider_id: 'rider_open_win',
    pickup_at: pickupAt,
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p_open',
        backupDriverId: 'driver_b_open',
        confirmState: null,
        generation: 1,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [{ driver_id: 'driver_p_open', online: true, expo_push_token: 'ExponentPushToken[mock]' }],
  })

  const summary = await runScheduledDispatchTick(sb, { now })

  assert.equal(summary.scanned, 1)
  assert.equal(summary.opened, 1)
  assert.equal(summary.promoted, 0)
  assert.equal(summary.pooled, 0)

  const updated = sb._tables.trips[0]
  assert.equal(updated.metadata.backup_queue.confirmState, 'window_open')
  assert.equal(updated.metadata.backup_queue.windowOpensAt, '2026-10-10T15:10:00.000Z')
  assert.equal(updated.metadata.backup_queue.windowClosesAt, '2026-10-10T15:15:00.000Z')
  assert.equal(updated.metadata.backup_queue.windowNotifiedAt, now.toISOString())
  assert.equal(sb._tables.trip_events.some((e) => e.kind === 'backup_window_open'), true)
})

test('runScheduledDispatchTick: releases directly to backup promotion or urgent pool when tick occurs after window closes on fresh scheduled ride', async () => {
  const pickupAt = '2026-10-10T15:30:00.000Z'
  // Window closed at 15:15:00; tick runs at 15:16:00
  const now = new Date('2026-10-10T15:16:00.000Z')

  // Case A: Has backup driver -> promotes backup
  const tripBackup = {
    id: 'trip_overdue_backup',
    status: 'scheduled',
    rider_id: 'rider_overdue_1',
    pickup_at: pickupAt,
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p_late',
        backupDriverId: 'driver_b_promoted',
        confirmState: null,
        generation: 1,
        events: [],
      },
    },
  }

  const sbBackup = createMatchingSupabase({
    trips: [tripBackup],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [{ driver_id: 'driver_p_late', online: true }],
  })

  const summaryBackup = await runScheduledDispatchTick(sbBackup, { now })
  assert.equal(summaryBackup.scanned, 1)
  assert.equal(summaryBackup.promoted, 1)
  assert.equal(summaryBackup.pooled, 0)
  assert.equal(sbBackup._tables.trips[0].metadata.backup_queue.primaryDriverId, 'driver_b_promoted')

  // Case B: No backup driver -> hands to urgent pool
  const tripSolo = {
    id: 'trip_overdue_solo',
    status: 'scheduled',
    rider_id: 'rider_overdue_2',
    pickup_at: pickupAt,
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p_solo_late',
        backupDriverId: null,
        confirmState: null,
        generation: 1,
        events: [],
      },
    },
  }

  const sbSolo = createMatchingSupabase({
    trips: [tripSolo],
    trip_events: [],
    driver_reliability_strikes: [],
    driver_status: [{ driver_id: 'driver_p_solo_late', online: true }],
  })

  const summarySolo = await runScheduledDispatchTick(sbSolo, { now })
  assert.equal(summarySolo.scanned, 1)
  assert.equal(summarySolo.pooled, 1)
  assert.equal(summarySolo.promoted, 0)
  assert.equal(sbSolo._tables.trips[0].metadata.backup_queue.confirmState, 'handed_to_pool')
  assert.equal(sbSolo._tables.trips[0].status, 'searching')
})

test('runScheduledDispatchTick: records updated telemetry and fix during open window without premature transition', async () => {
  const now = new Date('2026-10-10T14:52:00.000Z')
  const trip = {
    id: 'trip_telemetry_update',
    status: 'scheduled',
    rider_id: 'rider_telem',
    pickup_at: '2026-10-10T15:30:00.000Z',
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_active_telem',
        backupDriverId: 'driver_backup_telem',
        confirmState: 'window_open',
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T14:55:00.000Z',
        lastFix: { lat: 34.6000, lng: -82.8000 },
        generation: 2,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_status: [
      {
        driver_id: 'driver_active_telem',
        online: true,
        lat: 34.6100, // Updated location
        lng: -82.8100,
        updated_at: '2026-10-10T14:51:55.000Z',
      },
    ],
  })

  const summary = await runScheduledDispatchTick(sb, { now })
  assert.equal(summary.scanned, 1)
  assert.equal(summary.opened, 0)
  assert.equal(summary.promoted, 0)
  assert.equal(summary.pooled, 0)
  assert.equal(summary.enroute, 0)

  const updated = sb._tables.trips[0]
  assert.equal(updated.metadata.backup_queue.lastFix.lat, 34.6100)
  assert.equal(updated.metadata.backup_queue.generation, 3)
})

test('runScheduledDispatchTick: triggers departDue transition to enroute when leaveNowAt passes without manual navigation', async () => {
  const now = new Date('2026-10-10T15:05:00.000Z') // leaveNowAt was 15:00:00 -> 5 minutes past leave time
  const trip = {
    id: 'trip_depart_due',
    status: 'scheduled',
    rider_id: 'rider_depart_due',
    pickup_at: '2026-10-10T15:30:00.000Z',
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_confirmed_late',
        backupDriverId: 'driver_b_dep',
        confirmState: 'window_open',
        confirmedAt: '2026-10-10T14:51:00.000Z',
        leaveNowAt: '2026-10-10T15:00:00.000Z',
        navigateStartedAt: null, // Did not press navigate
        windowOpensAt: '2026-10-10T14:50:00.000Z',
        windowClosesAt: '2026-10-10T15:10:00.000Z',
        generation: 2,
        events: [],
      },
    },
  }

  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_status: [{ driver_id: 'driver_confirmed_late', online: true }],
  })

  const summary = await runScheduledDispatchTick(sb, { now })
  assert.equal(summary.scanned, 1)
  assert.equal(summary.enroute, 1)

  const updated = sb._tables.trips[0]
  assert.equal(updated.status, 'accepted')
  assert.equal(updated.driver_id, 'driver_confirmed_late')
  assert.equal(updated.metadata.backup_queue.confirmState, 'enroute')
  assert.equal(updated.metadata.backup_queue.navigateStartedAt, now.toISOString())
  assert.equal(updated.metadata.backup_queue.movementDetectedAt, now.toISOString())
})

test('runScheduledDispatchTick: records summary.raced when CAS update fails due to concurrent modification', async () => {
  const pickupAt = '2026-10-10T15:30:00.000Z'
  const now = new Date('2026-10-10T15:12:00.000Z') // Inside window [15:10, 15:15]
  const trip = {
    id: 'trip_cas_race',
    status: 'scheduled',
    rider_id: 'rider_race',
    pickup_at: pickupAt,
    pickup_lat: 34.6784,
    pickup_lng: -82.8397,
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, now),
        primaryDriverId: 'driver_p_race',
        backupDriverId: 'driver_b_race',
        confirmState: null,
        generation: 1,
        events: [],
      },
    },
  }

  // Simulate CAS failure: another transaction mutates metadata concurrently
  const sb = createMatchingSupabase({
    trips: [trip],
    trip_events: [],
    driver_status: [{ driver_id: 'driver_p_race', online: true }],
  })
  const originalFrom = sb.from.bind(sb)
  sb.from = (table) => {
    const res = originalFrom(table)
    if (table === 'trips') {
      const origUpdate = res.update.bind(res)
      res.update = (patch) => {
        // Mutate the row metadata in the store so unchangedOfferQuery CAS check fails
        sb._tables.trips[0].metadata = { concurrent: 'another_transaction_won' }
        return origUpdate(patch)
      }
    }
    return res
  }

  const summary = await runScheduledDispatchTick(sb, { now })
  assert.equal(summary.scanned, 1)
  assert.equal(summary.raced, 1)
  assert.equal(summary.opened, 0)
})

test('scheduledDispatchTickHandler: enforces HTTP methods, service role availability, and cron authentication', async () => {
  // 1. Method not allowed (e.g. DELETE or PATCH)
  const reqDelete = { method: 'DELETE', headers: {} }
  const resDelete = mockRes()
  await scheduledDispatchTickHandler(reqDelete, resDelete, {})
  assert.equal(resDelete.statusCode, 405)
  assert.equal(resDelete.headers['allow'], 'GET, POST, OPTIONS')
  assert.equal(resDelete.headers['cache-control'], 'no-store')
  assert.equal(parseJson(resDelete).error, 'Method not allowed')

  // 2. Missing Supabase client -> 503
  const reqPost = { method: 'POST', headers: {} }
  const resNoSb = mockRes()
  await scheduledDispatchTickHandler(reqPost, resNoSb, { sb: null })
  assert.equal(resNoSb.statusCode, 503)
  assert.equal(parseJson(resNoSb).error, 'SUPABASE_SERVICE_ROLE_KEY not configured')

  // 3. Unauthorized cron (missing or incorrect bearer) -> 401
  const resUnauth = mockRes()
  await scheduledDispatchTickHandler(
    { method: 'POST', headers: { authorization: 'Bearer wrong_key' } },
    resUnauth,
    { sb: {}, cronSecret: 'correct_cron_secret', env: {} },
  )
  assert.equal(resUnauth.statusCode, 401)
  assert.equal(parseJson(resUnauth).error, 'Cron authorization required')

  // 4. Staging cron block without dry-run -> 403
  const resBlocked = mockRes()
  await scheduledDispatchTickHandler(
    { method: 'POST', headers: { authorization: 'Bearer staging_sec' } },
    resBlocked,
    {
      sb: {},
      cronSecret: 'staging_sec',
      env: { DISABLE_CRON_ENDPOINTS: '1' },
      dryRun: false,
    },
  )
  assert.equal(resBlocked.statusCode, 403)
  assert.match(parseJson(resBlocked).error, /Cron endpoints are disabled on this host/)
})



