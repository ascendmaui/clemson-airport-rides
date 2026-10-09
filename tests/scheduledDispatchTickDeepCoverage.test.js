import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runScheduledDispatchTick,
} from '../server/backupDriverDispatch.js'
import scheduledDispatchTickHandler from '../server/endpoints/scheduledDispatchTick.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'
import { createMatchingSupabase } from './fixtures/matchingE2E.js'

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
