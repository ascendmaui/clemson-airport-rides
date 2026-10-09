import test from 'node:test'
import assert from 'node:assert/strict'
import driverPayoutsHandler, { runDuePayouts, payoutDryRunRequested } from '../server/endpoints/driverPayouts.js'

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
