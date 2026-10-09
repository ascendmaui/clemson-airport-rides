import test from 'node:test'
import assert from 'node:assert/strict'
import handleBackupQueue from '../server/endpoints/backupQueue.js'
import handleScheduledRider from '../server/endpoints/scheduledRider.js'
import scheduledDispatchTickHandler from '../server/endpoints/scheduledDispatchTick.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'

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

test('handleBackupQueue: enforces method, auth, tripId, and onboarding approval gates', async () => {
  // 1. Method 405
  const res405 = mockRes()
  await handleBackupQueue({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // 2. Missing sb 503
  const res503 = mockRes()
  await handleBackupQueue({ method: 'POST', body: { tripId: 't1' } }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // 3. Unauth 401
  const res401 = mockRes()
  await handleBackupQueue({ method: 'POST', body: { tripId: 't1' } }, res401, { sb: {}, user: null })
  assert.equal(res401.statusCode, 401)

  // 4. Missing tripId 400
  const resNoTrip = mockRes()
  await handleBackupQueue({ method: 'POST', body: { tripId: '   ' } }, resNoTrip, { sb: {}, user: { id: 'd1' } })
  assert.equal(resNoTrip.statusCode, 400)
  assert.match(parseJson(resNoTrip).error, /trip id required/i)

  // 5. Database error loading driver_applications 500
  const sbAppError = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'Database query failure' } }),
        }),
      }),
    }),
  }
  const resAppErr = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't1', op: 'accept' } },
    resAppErr,
    { sb: sbAppError, user: { id: 'd1' } },
  )
  assert.equal(resAppErr.statusCode, 500)
  assert.equal(parseJson(resAppErr).error, 'Database query failure')

  // 6. Driver not approved 403
  const sbUnderReview = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { onboarding_status: 'reviewing' }, error: null }),
        }),
      }),
    }),
  }
  const res403 = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't1', op: 'accept' } },
    res403,
    { sb: sbUnderReview, user: { id: 'd1' } },
  )
  assert.equal(res403.statusCode, 403)
  assert.match(parseJson(res403).error, /Finish approval to go online/i)
})

test('handleBackupQueue: dispatches accept, confirm, navigate, cancel, release, and unknown actions', async () => {
  const sbApproved = {
    from: (table) => {
      if (table === 'driver_applications') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { onboarding_status: 'approved' }, error: null }),
            }),
          }),
        }
      }
      return {}
    },
  }

  // Helper to create trips mock
  function createDispatchSb({ trip, error = null }) {
    return {
      from: (table) => {
        if (table === 'driver_applications') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { onboarding_status: 'approved' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'trips') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: trip, error }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: trip, error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { full_name: 'Driver Dave', rating_avg: 4.9 }, error: null }),
              }),
            }),
          }
        }
        return {
          insert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      },
    }
  }

  // 1. op: 'accept' returns 200 when slot is accepted
  const queueData = {
    ...backupBookingMetadata(1000, new Date()),
    primaryDriverId: null,
    backupDriverId: null,
    generation: 1,
    events: [],
  }
  const tripToAccept = {
    id: 't_accept',
    status: 'scheduled',
    metadata: { backup_queue: queueData },
  }
  const sbAccept = createDispatchSb({ trip: tripToAccept })
  const resAccept = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't_accept', op: 'accept' } },
    resAccept,
    { sb: sbAccept, user: { id: 'd_accept' } },
  )
  assert.equal(resAccept.statusCode, 200)
  const bodyAccept = parseJson(resAccept)
  assert.equal(bodyAccept.ok, true)
  assert.equal(bodyAccept.role, 'primary')

  // 2. op: 'confirm' returns 200
  const tripToConfirm = {
    id: 't_confirm',
    status: 'scheduled',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, new Date()),
        primaryDriverId: 'd_confirm',
        backupDriverId: null,
        confirmState: 'window_open',
        generation: 1,
        events: [],
      },
    },
  }
  const sbConfirm = createDispatchSb({ trip: tripToConfirm })
  const resConfirm = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't_confirm', op: 'confirm' } },
    resConfirm,
    { sb: sbConfirm, user: { id: 'd_confirm' } },
  )
  assert.equal(resConfirm.statusCode, 200)
  assert.equal(parseJson(resConfirm).ok, true)

  // 3. op: 'navigate' calls confirm with navigate: true
  const resNavigate = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't_confirm', op: 'navigate' } },
    resNavigate,
    { sb: sbConfirm, user: { id: 'd_confirm' } },
  )
  assert.equal(resNavigate.statusCode, 200)
  assert.equal(parseJson(resNavigate).ok, true)

  // 4. op: 'cancel' calls cancelBackupPrimary
  const tripToCancel = {
    id: 't_cancel',
    status: 'scheduled',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, new Date()),
        primaryDriverId: 'd_cancel',
        backupDriverId: 'd_other',
        confirmState: 'waiting',
        generation: 1,
        events: [],
      },
    },
  }
  const sbCancel = createDispatchSb({ trip: tripToCancel })
  const resCancel = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't_cancel', op: 'cancel' } },
    resCancel,
    { sb: sbCancel, user: { id: 'd_cancel' } },
  )
  assert.equal(resCancel.statusCode, 200)
  assert.equal(parseJson(resCancel).ok, true)

  // 5. op: 'release' calls releaseBackupDriver
  const tripToRelease = {
    id: 't_release',
    status: 'scheduled',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, new Date()),
        primaryDriverId: 'd_main',
        backupDriverId: 'd_release',
        generation: 1,
        events: [],
      },
    },
  }
  const sbRelease = createDispatchSb({ trip: tripToRelease })
  const resRelease = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't_release', op: 'release' } },
    resRelease,
    { sb: sbRelease, user: { id: 'd_release' } },
  )
  assert.equal(resRelease.statusCode, 200)
  assert.equal(parseJson(resRelease).ok, true)

  // 6. Unknown action 400
  const resUnknown = mockRes()
  await handleBackupQueue(
    { method: 'POST', body: { tripId: 't1', op: 'dance' } },
    resUnknown,
    { sb: sbApproved, user: { id: 'd1' } },
  )
  assert.equal(resUnknown.statusCode, 400)
  assert.equal(parseJson(resUnknown).error, 'Unknown backup queue action: dance')
})

test('handleScheduledRider: dispatches detail, switch, and cancel with hold settlement', async () => {
  // 1. Method 405
  const res405 = mockRes()
  await handleScheduledRider({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // 2. Missing sb 503
  const res503 = mockRes()
  await handleScheduledRider({ method: 'POST', body: { tripId: 't1' } }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // 3. Unauth 401
  const res401 = mockRes()
  await handleScheduledRider({ method: 'POST', body: { tripId: 't1' } }, res401, { sb: {}, user: null })
  assert.equal(res401.statusCode, 401)

  // 4. Missing tripId 400
  const resNoTrip = mockRes()
  await handleScheduledRider({ method: 'POST', body: { tripId: '   ' } }, resNoTrip, { sb: {}, user: { id: 'r1' } })
  assert.equal(resNoTrip.statusCode, 400)

  // 5. Unknown op 400
  const resBadOp = mockRes()
  await handleScheduledRider({ method: 'POST', body: { tripId: 't1', op: 'teleport' } }, resBadOp, { sb: {}, user: { id: 'r1' } })
  assert.equal(resBadOp.statusCode, 400)
  assert.match(parseJson(resBadOp).error, /Unknown scheduled rider action: teleport/i)

  // 6. op: 'detail' returns 200 with queue information
  const scheduledTrip = {
    id: 't_sched_1',
    rider_id: 'r_rider',
    status: 'scheduled',
    metadata: {
      backup_queue: {
        ...backupBookingMetadata(1000, new Date()),
        primaryDriverId: 'd_1',
        backupDriverId: 'd_2',
        generation: 1,
        events: [],
      },
    },
  }
  const sbDetail = {
    from: (table) => {
      if (table === 'trips') {
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: () => chain,
          maybeSingle: async () => ({ data: scheduledTrip, error: null }),
        }
        return {
          select: () => chain,
          update: () => chain,
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { full_name: 'Driver 1', rating_avg: 5.0 }, error: null }),
            }),
          }),
        }
      }
      return {}
    },
  }
  const resDetail = mockRes()
  await handleScheduledRider(
    { method: 'POST', body: { tripId: 't_sched_1', op: 'detail' } },
    resDetail,
    { sb: sbDetail, user: { id: 'r_rider' } },
  )
  assert.equal(resDetail.statusCode, 200)
  const bodyDetail = parseJson(resDetail)
  assert.equal(bodyDetail.ok, true)
  assert.ok(bodyDetail.backup)
  assert.equal(bodyDetail.backup.primary.name, 'Driver 1')

  // 7. op: 'cancel' when settleFareHold fails returns 402 with code 'capture_failed'
  const tripWithHold = {
    id: 't_hold_cancel',
    rider_id: 'r_rider',
    status: 'scheduled',
    fare_cents: 8000,
    metadata: {
      scheduled_boost_cents: 2000,
      backup_queue: {
        ...backupBookingMetadata(1000, new Date()),
        primaryDriverId: 'd_1',
        backupDriverId: 'd_2',
        bonusCents: 1000,
        generation: 1,
        events: [],
      },
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold_cancel',
      },
    },
  }
  const sbCancelFail = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tripWithHold, error: null }),
        }),
      }),
    }),
  }
  const failingSettle = async () => ({
    ok: false,
    message: 'Card declined for cancellation fee',
  })
  const resCancelFail = mockRes()
  await handleScheduledRider(
    { method: 'POST', body: { tripId: 't_hold_cancel', op: 'cancel' } },
    resCancelFail,
    { sb: sbCancelFail, user: { id: 'r_rider' }, settleFareHold: failingSettle },
  )
  assert.equal(resCancelFail.statusCode, 402)
  const bodyCancelFail = parseJson(resCancelFail)
  assert.equal(bodyCancelFail.code, 'capture_failed')
  assert.match(bodyCancelFail.error, /Could not capture the cancellation fee/i)

  // 8. op: 'cancel' when settleFareHold succeeds returns 200 with captured fee
  let tripUpdatedToCancel = null
  const sbCancelSuccess = {
    from: (table) => {
      if (table === 'trips') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: tripWithHold, error: null }),
            }),
          }),
          update: (patch) => {
            const chain = {
              eq: () => chain,
              is: () => chain,
              select: () => chain,
              maybeSingle: async () => {
                tripUpdatedToCancel = patch
                return { data: { ...tripWithHold, ...patch }, error: null }
              },
            }
            return chain
          },
        }
      }
      return {
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
      }
    },
  }
  const successfulSettle = async ({ finalFareCents }) => ({
    ok: true,
    amountCents: finalFareCents,
    method: 'card',
  })
  const resCancelSuccess = mockRes()
  await handleScheduledRider(
    { method: 'POST', body: { tripId: 't_hold_cancel', op: 'cancel' } },
    resCancelSuccess,
    { sb: sbCancelSuccess, user: { id: 'r_rider' }, settleFareHold: successfulSettle },
  )
  assert.equal(resCancelSuccess.statusCode, 200)
  const bodyCancelSuccess = parseJson(resCancelSuccess)
  assert.equal(bodyCancelSuccess.ok, true)
  assert.equal(bodyCancelSuccess.action, 'cancel')
  assert.equal(bodyCancelSuccess.boostRefunded, true)
  assert.equal(tripUpdatedToCancel?.status, 'canceled')
})

test('scheduledDispatchTickHandler: validates HTTP methods, auth, staging blocks, and execution exceptions', async () => {
  // 1. Method 405 on PUT and DELETE
  const resPut = mockRes()
  await scheduledDispatchTickHandler({ method: 'PUT' }, resPut, {})
  assert.equal(resPut.statusCode, 405)

  const resDelete = mockRes()
  await scheduledDispatchTickHandler({ method: 'DELETE' }, resDelete, {})
  assert.equal(resDelete.statusCode, 405)

  // 2. Missing sb 503
  const res503 = mockRes()
  await scheduledDispatchTickHandler({ method: 'GET' }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // 3. Unauthorized 401
  const res401 = mockRes()
  await scheduledDispatchTickHandler(
    { method: 'GET', headers: { authorization: 'Bearer wrong_token' } },
    res401,
    { sb: {}, cronSecret: 'correct_cron_secret' },
  )
  assert.equal(res401.statusCode, 401)
  assert.match(parseJson(res401).error, /Cron authorization required/i)

  // 4. Staging cron block when DISABLE_CRON_ENDPOINTS=1 (403)
  const resBlocked = mockRes()
  await scheduledDispatchTickHandler(
    { method: 'GET', headers: { authorization: 'Bearer secret123' } },
    resBlocked,
    {
      sb: {},
      cronSecret: 'secret123',
      env: { DISABLE_CRON_ENDPOINTS: '1' },
    },
  )
  assert.equal(resBlocked.statusCode, 403)
  assert.match(parseJson(resBlocked).error, /Cron endpoints are disabled/i)

  // 5. Exception during runScheduledDispatchTick returns 500
  const sbCrashing = {
    from: () => ({
      select: () => {
        throw new Error('Database disk full')
      },
    }),
  }
  const res500 = mockRes()
  await scheduledDispatchTickHandler(
    { method: 'GET', headers: { authorization: 'Bearer secret123' } },
    res500,
    {
      sb: sbCrashing,
      cronSecret: 'secret123',
      env: {},
    },
  )
  assert.equal(res500.statusCode, 500)
  assert.equal(parseJson(res500).error, 'Database disk full')
})
