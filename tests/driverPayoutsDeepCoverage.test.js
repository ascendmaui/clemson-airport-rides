import test from 'node:test'
import assert from 'node:assert/strict'
import driverPayoutsHandler, {
  runDuePayouts,
  payoutDryRunRequested,
  isVercelCron,
  runningOnVercel,
  cronAuthorized,
} from '../server/endpoints/driverPayouts.js'
import {
  attemptStandbyBackupPayout,
  attemptSwitchFeePayout,
  attemptCancelFeePayout,
  loadConnectAccount,
  writePayout,
} from '../server/payouts.js'

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

test('payoutDryRunRequested: parses boolean flag from query object and url params', () => {
  assert.equal(payoutDryRunRequested({ query: { dry_run: '1' } }), true)
  assert.equal(payoutDryRunRequested({ query: { dryRun: 'true' } }), true)
  assert.equal(payoutDryRunRequested({ query: { dry_run: ['1'] } }), true)
  assert.equal(payoutDryRunRequested({ query: { dry_run: '0' } }), false)
  assert.equal(payoutDryRunRequested({ url: '/api/driver-payouts?dry_run=1' }), true)
  assert.equal(payoutDryRunRequested({ url: '/api/driver-payouts?dryRun=true' }), true)
  assert.equal(payoutDryRunRequested({ url: '/api/driver-payouts?dry_run=0' }), false)
  assert.equal(payoutDryRunRequested({ url: '/api/driver-payouts' }), false)
  assert.equal(payoutDryRunRequested(null), false)
})

test('runDuePayouts: processes standby backup payout and switch fee payout alongside primary payout in live mode', async () => {
  const trip = {
    id: 'trip_multi_payout',
    driver_id: 'driver_primary',
    fare_cents: 10000,
    metadata: {
      payout: { status: 'failed', nextRetryAt: Date.now() - 5000, attempts: 1, amountCents: 8000 },
      backup_queue: {
        backupDriverId: 'driver_standby',
        switchFeeDriverId: 'driver_former',
      },
    },
  }

  let primaryAttempted = false
  let standbyAttempted = false
  let switchFeeAttempted = false
  let writtenPayouts = []

  const deps = {
    now: Date.now(),
    dryRun: false,
    loadConnectAccount: async (sb, id) => `acct_${id}`,
    attemptDriverPayout: async ({ trip: t }) => {
      primaryAttempted = true
      return { ok: true, payout: { status: 'paid', amountCents: 8000, attempts: 2 } }
    },
    writePayout: async (sb, t, payout) => {
      writtenPayouts.push(payout)
    },
    attemptStandbyBackupPayout: async ({ trip: t, dryRun }) => {
      standbyAttempted = true
      assert.equal(dryRun, false)
      return {
        ok: true,
        payout: { status: 'paid', amountCents: 1500, driverId: 'driver_standby' },
        idempotent: false,
      }
    },
    attemptSwitchFeePayout: async ({ trip: t, dryRun }) => {
      switchFeeAttempted = true
      assert.equal(dryRun, false)
      return {
        ok: true,
        payout: { status: 'paid', amountCents: 1000, driverId: 'driver_former' },
        idempotent: false,
      }
    },
  }

  const results = await runDuePayouts({}, [trip], null, deps)

  assert.equal(primaryAttempted, true)
  assert.equal(standbyAttempted, true)
  assert.equal(switchFeeAttempted, true)
  assert.equal(writtenPayouts.length, 1)

  // Primary + Standby + Switch fee results
  assert.equal(results.length, 3)
  assert.equal(results[0].tripId, 'trip_multi_payout')
  assert.equal(results[0].status, 'paid')

  assert.equal(results[1].role, 'standby')
  assert.equal(results[1].driverId, 'driver_standby')
  assert.equal(results[1].amountCents, 1500)
  assert.equal(results[1].dryRun, false)

  assert.equal(results[2].role, 'switch_fee')
  assert.equal(results[2].driverId, 'driver_former')
  assert.equal(results[2].amountCents, 1000)
  assert.equal(results[2].label, 'Switch fee')
})

test('runDuePayouts: computes wouldTransfer and amounts in dryRun mode without mutating or calling transfers', async () => {
  const trip = {
    id: 'trip_dry_run',
    driver_id: 'driver_dry',
    fare_cents: 5000,
    metadata: {
      payout: { status: 'pending', attempts: 0, amountCents: 4000 },
    },
  }

  let attemptedReal = false
  const deps = {
    dryRun: true,
    attemptDriverPayout: async () => {
      attemptedReal = true
    },
    writePayout: async () => {
      attemptedReal = true
    },
    attemptStandbyBackupPayout: async ({ dryRun }) => {
      assert.equal(dryRun, true)
      return {
        ok: true,
        payout: { status: 'pending', amountCents: 1500, driverId: 'driver_sb' },
        idempotent: false,
      }
    },
    attemptSwitchFeePayout: async ({ dryRun }) => {
      assert.equal(dryRun, true)
      return null
    },
  }

  const results = await runDuePayouts({}, [trip], null, deps)

  assert.equal(attemptedReal, false)
  assert.equal(results.length, 2)
  assert.equal(results[0].dryRun, true)
  assert.equal(results[0].amountCents, 4000)
  assert.equal(results[0].wouldTransfer, true)

  assert.equal(results[1].role, 'standby')
  assert.equal(results[1].dryRun, true)
  assert.equal(results[1].wouldTransfer, true)
})

test('runDuePayouts: falls back to resolveDriverNetCents when payout.amountCents is null or empty in dryRun', async () => {
  const trip = {
    id: 'trip_fallback_net',
    driver_id: 'driver_1',
    fare_cents: 6000,
    metadata: {
      driver_net_cents: 4800,
      payout: { status: 'pending', attempts: 0, amountCents: null },
    },
  }

  const results = await runDuePayouts({}, [trip], null, {
    dryRun: true,
    attemptStandbyBackupPayout: async () => null,
    attemptSwitchFeePayout: async () => null,
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].amountCents, 4800)
  assert.equal(results[0].wouldTransfer, true)
})

test('driverPayoutsHandler: clamps limit parameter properly for cron mode [1, 200] and user mode [1, 100]', async () => {
  let queriedLimitCron = null
  const mockSbCron = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async (lim) => {
              queriedLimitCron = lim
              return { data: [], error: null }
            },
          }),
        }),
      }),
    }),
  }

  // Cron query clamping (default 80, min 1, max 200)
  const cronResHigh = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { authorization: 'Bearer secret_cron' } },
    cronResHigh,
    { sb: mockSbCron, cronSecret: 'secret_cron', limit: 500, env: {} },
  )
  assert.equal(queriedLimitCron, 200)

  const cronResLow = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { authorization: 'Bearer secret_cron' } },
    cronResLow,
    { sb: mockSbCron, cronSecret: 'secret_cron', limit: -10, env: {} },
  )
  assert.equal(queriedLimitCron, 1)

  // Signed-in driver query clamping (default 40, min 1, max 100)
  let queriedLimitUser = null
  const mockSbUser = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async (lim) => {
                queriedLimitUser = lim
                return { data: [], error: null }
              },
            }),
          }),
        }),
      }),
    }),
  }

  const userResHigh = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: {} },
    userResHigh,
    { sb: mockSbUser, user: { id: 'd_user' }, limit: 999 },
  )
  assert.equal(queriedLimitUser, 100)

  const userResLow = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: {} },
    userResLow,
    { sb: mockSbUser, user: { id: 'd_user' }, limit: -5 },
  )
  assert.equal(queriedLimitUser, 1)
})

test('driverPayoutsHandler: handles database query errors on completed trips with 500', async () => {
  const mockSbError = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: null, error: { message: 'Database connection timeout' } }),
          }),
        }),
      }),
    }),
  }

  const res = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { authorization: 'Bearer cron_secret' } },
    res,
    { sb: mockSbError, cronSecret: 'cron_secret', env: {} },
  )
  assert.equal(res.statusCode, 500)
  const body = parseJson(res)
  assert.equal(body.error, 'Database connection timeout')
})

test('driverPayoutsHandler: stagingCronBlock blocks driver POST retry when DISABLE_CRON_ENDPOINTS is enabled', async () => {
  const req = { method: 'POST', headers: {} }
  const res = mockRes()
  const mockSb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  await driverPayoutsHandler(req, res, {
    sb: mockSb,
    user: { id: 'd_block' },
    env: { DISABLE_CRON_ENDPOINTS: '1' },
  })

  assert.equal(res.statusCode, 403)
  const body = parseJson(res)
  assert.equal(body.error, 'Cron endpoints are disabled on this host')
})

function createMockPayoutDb({ trip = null, profile = null, tripsUpdateError = null, payoutsUpsertError = null, backupUpsertError = null } = {}) {
  let storedTrip = trip ? { ...trip, metadata: { ...(trip.metadata || {}) } } : null
  const writtenPayouts = []
  const writtenBackupPayouts = []

  return {
    _writtenPayouts: writtenPayouts,
    _writtenBackupPayouts: writtenBackupPayouts,
    get storedTrip() { return storedTrip },
    from(table) {
      if (table === 'trips') {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: storedTrip && storedTrip[col] === val ? { id: storedTrip.id, metadata: storedTrip.metadata } : null,
                error: null,
              }),
            }),
          }),
          update: (patch) => ({
            eq: (col, val) => {
              if (tripsUpdateError) return Promise.resolve({ data: null, error: { message: tripsUpdateError } })
              if (storedTrip && storedTrip[col] === val) {
                storedTrip = { ...storedTrip, ...patch, metadata: { ...(storedTrip.metadata || {}), ...(patch.metadata || {}) } }
                return Promise.resolve({ data: storedTrip, error: null })
              }
              return Promise.resolve({ data: null, error: { message: 'Trip not found' } })
            },
          }),
        }
      }
      if (table === 'driver_payouts') {
        return {
          upsert: async (row) => {
            writtenPayouts.push(row)
            if (payoutsUpsertError) return { data: null, error: { message: payoutsUpsertError } }
            return { data: row, error: null }
          },
        }
      }
      if (table === 'backup_driver_payouts') {
        return {
          upsert: async (row) => {
            writtenBackupPayouts.push(row)
            if (backupUpsertError) return { data: null, error: { message: backupUpsertError } }
            return { data: row, error: null }
          },
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                if (!profile) return { data: null, error: null }
                return { data: profile[col] === val ? profile : null, error: null }
              },
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }
}

test('isVercelCron and runningOnVercel: verifies header extraction and environment detection', () => {
  assert.equal(runningOnVercel({ VERCEL: '1' }), true)
  assert.equal(runningOnVercel({ VERCEL: ' ' }), false)
  assert.equal(runningOnVercel({}), false)
  assert.equal(runningOnVercel(null), false)

  assert.equal(isVercelCron({ headers: { 'x-vercel-cron': '1' } }), true)
  assert.equal(isVercelCron({ headers: { 'X-Vercel-Cron': '' } }), true)
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron-schedule': '0 * * * *' } }), true)
  assert.equal(isVercelCron({ headers: { 'user-agent': 'Vercel-Cron/1.0 (aws-us-east-1)' } }), true)
  assert.equal(isVercelCron({ headers: { 'user-agent': 'Mozilla/5.0' } }), false)
  assert.equal(isVercelCron({ headers: {} }), false)
  assert.equal(isVercelCron(null), false)
})

test('driverPayoutsHandler: handles Vercel vs off-Vercel cron signals with and without secret', async () => {
  const emptySb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }

  // 1. On Vercel: x-vercel-cron signal without bearer -> 200 skipped
  const resVercelNoBearer = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { 'x-vercel-cron': '1' } },
    resVercelNoBearer,
    { sb: emptySb, env: { VERCEL: '1', CRON_SECRET: 'secret_cron_123' } },
  )
  assert.equal(resVercelNoBearer.statusCode, 200)
  assert.equal(parseJson(resVercelNoBearer).skipped, true)

  // 2. On Vercel: user-agent vercel-cron/1.0 without bearer -> 200 skipped
  const resVercelUaNoBearer = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { 'user-agent': 'vercel-cron/1.0' } },
    resVercelUaNoBearer,
    { sb: emptySb, env: { VERCEL: '1', CRON_SECRET: 'secret_cron_123' } },
  )
  assert.equal(resVercelUaNoBearer.statusCode, 200)
  assert.equal(parseJson(resVercelUaNoBearer).skipped, true)

  // 3. On Vercel: valid bearer + x-vercel-cron -> 200 ok (cron path)
  const resVercelOk = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { 'x-vercel-cron': '1', authorization: 'Bearer secret_cron_123' } },
    resVercelOk,
    { sb: emptySb, env: { VERCEL: '1', CRON_SECRET: 'secret_cron_123' } },
  )
  assert.equal(resVercelOk.statusCode, 200)
  assert.equal(parseJson(resVercelOk).ok, true)

  // 4. On Vercel: valid bearer but NO vercel cron signal -> falls through to user auth (401 without user)
  const resVercelNoSignal = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { authorization: 'Bearer secret_cron_123' } },
    resVercelNoSignal,
    { sb: emptySb, env: { VERCEL: '1', CRON_SECRET: 'secret_cron_123' }, user: null },
  )
  assert.equal(resVercelNoSignal.statusCode, 401)
  assert.equal(parseJson(resVercelNoSignal).error, 'Sign in required')

  // 5. Off Vercel: spoofed x-vercel-cron header without bearer -> falls through to user auth (401)
  const resOffVercelSpoof = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { 'x-vercel-cron': '1' } },
    resOffVercelSpoof,
    { sb: emptySb, env: { CRON_SECRET: 'secret_cron_123' }, user: null },
  )
  assert.equal(resOffVercelSpoof.statusCode, 401)

  // 6. Off Vercel: valid bearer without any vercel headers -> enters cron path directly
  const resOffVercelOk = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: { authorization: 'Bearer secret_cron_123' } },
    resOffVercelOk,
    { sb: emptySb, env: { CRON_SECRET: 'secret_cron_123' } },
  )
  assert.equal(resOffVercelOk.statusCode, 200)
  assert.equal(parseJson(resOffVercelOk).ok, true)
})

test('driverPayoutsHandler: user mode handles database error on trips query with 500', async () => {
  const mockSbError = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: null, error: { message: 'trips_fetch_failed' } }),
            }),
          }),
        }),
      }),
    }),
  }

  const res = mockRes()
  await driverPayoutsHandler(
    { method: 'GET', headers: {} },
    res,
    { sb: mockSbError, user: { id: 'd_error' } },
  )
  assert.equal(res.statusCode, 500)
  const body = parseJson(res)
  assert.equal(body.error, 'trips_fetch_failed')
})

test('attemptStandbyBackupPayout: covers skipped null plan, already paid idempotent, and stripe transfer error', async () => {
  // 1. Trip with no backup queue plan returns null
  const noQueueTrip = { id: 'trip_no_bq', fare_cents: 4000 }
  const nullResult = await attemptStandbyBackupPayout({ trip: noQueueTrip })
  assert.equal(nullResult, null)

  // 2. Trip with already-paid standby payout returns idempotent: true
  const paidTrip = {
    id: 'trip_already_paid',
    fare_cents: 5000,
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        backupDriverId: 'driver_sb_paid',
        promotedFromBackup: false,
      },
      backup_standby_payout: {
        status: 'paid',
        amountCents: 1500,
        stripeTransferId: 'tr_paid_sb',
      },
    },
  }
  const idempotentResult = await attemptStandbyBackupPayout({ trip: paidTrip })
  assert.equal(idempotentResult.ok, true)
  assert.equal(idempotentResult.idempotent, true)
  assert.equal(idempotentResult.payout.stripeTransferId, 'tr_paid_sb')

  // 3. Dry-run mode returns without transferring or writing
  const dryTrip = {
    id: 'trip_dry_sb',
    fare_cents: 5000,
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        backupDriverId: 'driver_sb_dry',
        promotedFromBackup: false,
      },
    },
  }
  const dryResult = await attemptStandbyBackupPayout({ trip: dryTrip, dryRun: true })
  assert.equal(dryResult.ok, true)
  assert.equal(dryResult.dryRun, true)
  assert.equal(dryResult.payout.role, 'standby')
  assert.equal(dryResult.payout.amountCents, 1500)

  // 4. Live transfer error updates pending status and attempts
  const liveTrip = {
    id: 'trip_live_sb_err',
    fare_cents: 5000,
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        backupDriverId: 'driver_sb_live',
        promotedFromBackup: false,
      },
    },
  }
  const mockStripeError = {
    transfers: {
      create: async () => {
        throw new Error('Transfer destination not linked')
      },
    },
  }
  const sb = createMockPayoutDb({ trip: liveTrip })
  const errorResult = await attemptStandbyBackupPayout({
    sb,
    trip: liveTrip,
    stripe: mockStripeError,
    connectAccountId: 'acct_sb_live',
    now: 1700000000000,
  })

  assert.equal(errorResult.ok, false)
  assert.equal(errorResult.payout.status, 'pending')
  assert.equal(errorResult.payout.attempts, 1)
  assert.equal(errorResult.payout.lastError, 'Transfer destination not linked')
  assert.equal(sb.storedTrip.metadata.backup_standby_payout.status, 'pending')
  assert.equal(sb._writtenBackupPayouts.length, 1)
  assert.equal(sb._writtenBackupPayouts[0].role, 'standby')
  assert.equal(sb._writtenBackupPayouts[0].amount_cents, 1500)
})

test('attemptSwitchFeePayout and attemptCancelFeePayout: covers null plans, already paid, and transfer failures', async () => {
  // 1. Switch fee: returns null when trip has no switch fee
  const plainTrip = { id: 'trip_plain', fare_cents: 3000 }
  assert.equal(await attemptSwitchFeePayout({ trip: plainTrip }), null)

  // 2. Switch fee: returns idempotent when already paid
  const paidSwitchTrip = {
    id: 'trip_paid_switch',
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        backupBonusRedirected: true,
        switchFeeDriverId: 'driver_former_paid',
        switchFeeCents: 1000,
      },
      backup_switch_payout: {
        status: 'paid',
        amountCents: 1000,
      },
    },
  }
  const switchPaidResult = await attemptSwitchFeePayout({ trip: paidSwitchTrip })
  assert.equal(switchPaidResult.ok, true)
  assert.equal(switchPaidResult.idempotent, true)

  // 3. Switch fee: dry-run returns pending payout
  const drySwitchTrip = {
    id: 'trip_dry_switch',
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        backupBonusRedirected: true,
        switchFeeDriverId: 'driver_former_dry',
        switchFeeCents: 1000,
      },
    },
  }
  const drySwitchResult = await attemptSwitchFeePayout({ trip: drySwitchTrip, dryRun: true })
  assert.equal(drySwitchResult.ok, true)
  assert.equal(drySwitchResult.dryRun, true)
  assert.equal(drySwitchResult.payout.role, 'switch_fee')
  assert.equal(drySwitchResult.payout.label, 'Switch fee')

  // 4. Cancel fee: returns null when no cancelFeeDriverId or cents
  assert.equal(await attemptCancelFeePayout({ trip: plainTrip }), null)

  // 5. Cancel fee: uses Switch fee label if switchFeeDriverId is present, or Cancellation fee if not
  const cancelSwitchTrip = {
    id: 'trip_cancel_with_switch',
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        cancelFeeDriverId: 'driver_c1',
        cancelFeeCents: 1000,
        switchFeeDriverId: 'driver_c1',
      },
    },
  }
  const cancelSwitchRes = await attemptCancelFeePayout({ trip: cancelSwitchTrip, dryRun: true })
  assert.equal(cancelSwitchRes.payout.label, 'Switch fee')

  const cancelOnlyTrip = {
    id: 'trip_cancel_only',
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        cancelFeeDriverId: 'driver_c2',
        cancelFeeCents: 1200,
      },
    },
  }
  const cancelOnlyRes = await attemptCancelFeePayout({ trip: cancelOnlyTrip, dryRun: true })
  assert.equal(cancelOnlyRes.payout.label, 'Cancellation fee')
  assert.equal(cancelOnlyRes.payout.role, 'cancel_fee')
})

test('loadConnectAccount: extracts account ID or connect ID from profile and handles missing rows/errors', async () => {
  assert.equal(await loadConnectAccount(null, 'd_1'), null)
  assert.equal(await loadConnectAccount({}, null), null)

  const sbDirect = createMockPayoutDb({
    profile: { id: 'd_direct', stripe_account_id: 'acct_direct_123' },
  })
  assert.equal(await loadConnectAccount(sbDirect, 'd_direct'), 'acct_direct_123')

  const sbConnect = createMockPayoutDb({
    profile: { id: 'd_connect', stripe_connect_id: 'acct_connect_456' },
  })
  assert.equal(await loadConnectAccount(sbConnect, 'd_connect'), 'acct_connect_456')

  const sbEmpty = createMockPayoutDb({
    profile: { id: 'd_empty', stripe_account_id: null, stripe_connect_id: null },
  })
  assert.equal(await loadConnectAccount(sbEmpty, 'd_empty'), null)
})

test('writePayout: updates trip metadata, upserts driver_payouts, and tolerates missing table error', async () => {
  // 1. Missing trip returns no_trip
  assert.deepEqual(await writePayout(null, null, {}), { error: 'no_trip' })

  // 2. Successful write updates trips metadata and inserts driver_payouts
  const trip = { id: 'trip_write_ok', driver_id: 'driver_w1', metadata: { custom: 'field' } }
  const sbOk = createMockPayoutDb({ trip })
  const writeRes = await writePayout(sbOk, trip, {
    status: 'paid',
    amountCents: 4500,
    attempts: 1,
    stripeTransferId: 'tr_w1',
  })
  assert.equal(writeRes.error, null)
  assert.equal(writeRes.metadata.payout.status, 'paid')
  assert.equal(writeRes.metadata.custom, 'field')
  assert.equal(sbOk._writtenPayouts.length, 1)
  assert.equal(sbOk._writtenPayouts[0].stripe_transfer_id, 'tr_w1')

  // 3. Tolerates schema cache / missing table error on driver_payouts
  const sbMissingTable = createMockPayoutDb({
    trip,
    payoutsUpsertError: 'relation "driver_payouts" does not exist',
  })
  const writeResMissing = await writePayout(sbMissingTable, trip, {
    status: 'pending',
    amountCents: 4500,
  })
  assert.equal(writeResMissing.error, null)
})

