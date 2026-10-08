import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attemptCancelFeePayout,
  attemptDriverPayout,
  attemptStandbyBackupPayout,
  attemptSwitchFeePayout,
  buildPayoutRecord,
  enqueueAndAttemptPayout,
  loadConnectAccount,
  tigerHeatPayoutCents,
  writePayout,
} from './payouts.js'

test('buildPayoutRecord initializes pending record from trip fare', () => {
  const trip = {
    id: 'trip_1',
    driver_id: 'driver_1',
    fare_cents: 5000,
  }
  const record = buildPayoutRecord(trip)
  assert.equal(record.tripId, 'trip_1')
  assert.equal(record.driverId, 'driver_1')
  assert.equal(record.amountCents, 4000, 'Driver gets 80% default net')
  assert.equal(record.status, 'pending')
  assert.equal(record.pending, true)
  assert.equal(record.attempts, 0)
})

test('buildPayoutRecord sets $0 trips to paid immediately', () => {
  const zeroTrip = {
    id: 'trip_0',
    driver_id: 'driver_1',
    fare_cents: 0,
  }
  const record = buildPayoutRecord(zeroTrip)
  assert.equal(record.amountCents, 0)
  assert.equal(record.status, 'paid')
  assert.equal(record.pending, false)
})

test('attemptDriverPayout succeeds immediately for $0 trips', async () => {
  const trip = { id: 'trip_zero', driver_id: 'driver_1', fare_cents: 0 }
  const res = await attemptDriverPayout({ trip, stripe: {}, connectAccountId: 'acct_1' })
  assert.equal(res.ok, true)
  assert.equal(res.zero, true)
  assert.equal(res.payout.status, 'paid')
})

test('attemptDriverPayout returns idempotent success for already paid trips', async () => {
  const trip = {
    id: 'trip_paid',
    driver_id: 'driver_1',
    metadata: {
      payout: {
        tripId: 'trip_paid',
        status: 'paid',
        amountCents: 4000,
        stripeTransferId: 'tr_existing',
      },
    },
  }
  const res = await attemptDriverPayout({ trip, stripe: {}, connectAccountId: 'acct_1' })
  assert.equal(res.ok, true)
  assert.equal(res.idempotent, true)
  assert.equal(res.payout.stripeTransferId, 'tr_existing')
})

test('attemptDriverPayout records failure when driver lacks Connect account', async () => {
  const trip = { id: 'trip_no_acct', driver_id: 'driver_unlinked', fare_cents: 5000 }
  const res = await attemptDriverPayout({ trip, stripe: {}, connectAccountId: null })
  assert.equal(res.ok, false)
  assert.equal(res.payout.lastError, 'no_connect_account')
  assert.equal(res.payout.attempts, 1)
  assert.equal(res.payout.status, 'pending', 'Stays pending while retrying on backoff')
  assert.equal(res.payout.pending, true)
})

test('attemptDriverPayout calls Stripe transfers and marks payout paid', async () => {
  let transferPayload = null
  let transferOpts = null
  const mockStripe = {
    transfers: {
      create: async (payload, opts) => {
        transferPayload = payload
        transferOpts = opts
        return { id: 'tr_test_999' }
      },
    },
  }

  const trip = { id: 'trip_success', driver_id: 'driver_42', fare_cents: 6000 }
  const res = await attemptDriverPayout({
    trip,
    stripe: mockStripe,
    connectAccountId: 'acct_stripe_42',
    now: 1700000000000,
  })

  assert.equal(res.ok, true)
  assert.equal(res.payout.status, 'paid')
  assert.equal(res.payout.stripeTransferId, 'tr_test_999')
  assert.equal(transferPayload.amount, 4800)
  assert.equal(transferPayload.destination, 'acct_stripe_42')
  assert.equal(transferPayload.transfer_group, 'trip_success')
  assert.equal(transferOpts.idempotencyKey, 'payout:trip_success:0')
})

test('attemptDriverPayout handles Stripe API errors with retry backoff', async () => {
  const mockStripe = {
    transfers: {
      create: async () => {
        throw new Error('Balance insufficient')
      },
    },
  }

  const trip = { id: 'trip_err', driver_id: 'driver_42', fare_cents: 6000 }
  const now = 1700000000000
  const res = await attemptDriverPayout({
    trip,
    stripe: mockStripe,
    connectAccountId: 'acct_stripe_42',
    now,
  })

  assert.equal(res.ok, false)
  assert.equal(res.payout.status, 'pending', 'Stays pending while retrying on backoff')
  assert.equal(res.payout.pending, true)
  assert.equal(res.payout.attempts, 1)
  assert.equal(res.payout.lastError, 'Balance insufficient')
  assert.ok(new Date(res.payout.nextRetryAt).getTime() > now, 'Next retry is scheduled in future')

  // Calling again before nextRetryAt elapses should skip with reason not_due
  const retryTrip = {
    ...trip,
    metadata: { payout: res.payout },
  }
  const skipRes = await attemptDriverPayout({
    trip: retryTrip,
    stripe: mockStripe,
    connectAccountId: 'acct_stripe_42',
    now: now + 1000, // Only 1 second later
  })
  assert.equal(skipRes.ok, false)
  assert.equal(skipRes.skipped, true)
  assert.equal(skipRes.reason, 'not_due')
})

test('a settled Tiger Heat bonus replaces the 80 percent payout and an offer does not', () => {
  const fareOnly = { id: 'trip_plain', driver_id: 'driver_1', fare_cents: 5000 }
  assert.equal(tigerHeatPayoutCents(fareOnly), null)
  assert.equal(buildPayoutRecord(fareOnly).amountCents, 4000)
  assert.equal(buildPayoutRecord(fareOnly).tigerHeatBonusCents, 0)

  const offered = {
    ...fareOnly,
    metadata: { tiger_heat: { settled: false, bonusCents: 1200, driverEarningsCents: 5200 } },
  }
  assert.equal(tigerHeatPayoutCents(offered), null)
  assert.equal(buildPayoutRecord(offered).amountCents, 4000)

  const settled = {
    ...fareOnly,
    metadata: {
      tiger_heat: {
        settled: true,
        preview: false,
        bonusCents: 1200,
        driverEarningsCents: 5200,
        platformFundedCents: 200,
      },
    },
  }
  assert.equal(tigerHeatPayoutCents(settled), 5200)
  const record = buildPayoutRecord(settled)
  assert.equal(record.amountCents, 5200)
  assert.equal(record.tigerHeatBonusCents, 1200)
  assert.equal(record.platformFundedCents, 200)
})

function fakeSb({ trips = [], profiles = [] } = {}) {
  const tripStore = new Map(trips.map((t) => [t.id, { ...t, metadata: { ...(t.metadata || {}) } }]))
  const profileStore = new Map(profiles.map((p) => [p.id, { ...p }]))
  const upsertedPayouts = []
  const upsertedBackupPayouts = []

  return {
    _upsertedPayouts: upsertedPayouts,
    _upsertedBackupPayouts: upsertedBackupPayouts,
    _tripStore: tripStore,
    from(table) {
      if (table === 'trips') {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => {
                    const row = tripStore.get(val)
                    return { data: row ? { id: row.id, metadata: row.metadata } : null, error: null }
                  },
                }
              },
            }
          },
          update(patch) {
            return {
              eq(col, val) {
                const row = tripStore.get(val)
                if (row) {
                  Object.assign(row, patch)
                  return Promise.resolve({ data: row, error: null })
                }
                return Promise.resolve({ data: null, error: { message: 'Trip not found' } })
              },
            }
          },
        }
      }
      if (table === 'driver_payouts') {
        return {
          upsert: async (row) => {
            upsertedPayouts.push(row)
            return { data: row, error: null }
          },
        }
      }
      if (table === 'backup_driver_payouts') {
        return {
          upsert: async (row) => {
            upsertedBackupPayouts.push(row)
            return { data: row, error: null }
          },
        }
      }
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => {
                    const prof = profileStore.get(val)
                    return { data: prof || null, error: null }
                  },
                }
              },
            }
          },
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        upsert: async () => ({ data: null, error: null }),
      }
    },
  }
}

test('attemptStandbyBackupPayout handles no-standby, already paid, dry-run, and Stripe transfers', async () => {
  const plainTrip = { id: 't_plain', driver_id: 'd_1', fare_cents: 5000 }
  assert.equal(await attemptStandbyBackupPayout({ trip: plainTrip }), null)

  const standbyTrip = {
    id: 't_standby',
    driver_id: 'd_primary',
    fare_cents: 5000,
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1000,
        primaryDriverId: 'd_primary',
        backupDriverId: 'd_backup',
        promotedFromBackup: false,
        backupStoodBy: true,
      },
    },
  }

  // Dry run returns payout without Stripe transfer
  const dry = await attemptStandbyBackupPayout({
    trip: standbyTrip,
    dryRun: true,
  })
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.payout.driverId, 'd_backup')
  assert.equal(dry.payout.amountCents, 1000)
  assert.equal(dry.payout.role, 'standby')

  // Real attempt without connect account
  const sb = fakeSb({
    trips: [standbyTrip],
    profiles: [{ id: 'd_backup', stripe_account_id: null }],
  })
  const noAcct = await attemptStandbyBackupPayout({
    sb,
    trip: standbyTrip,
    stripe: { transfers: { create: async () => ({ id: 'tr_1' }) } },
  })
  assert.equal(noAcct.ok, false)
  assert.equal(noAcct.payout.lastError, 'no_connect_account')

  // Real attempt with connect account transfers via Stripe and writes to DB
  let transferCalls = []
  const mockStripe = {
    transfers: {
      create: async (payload, opts) => {
        transferCalls.push({ payload, opts })
        return { id: 'tr_standby_100' }
      },
    },
  }
  const realSuccess = await attemptStandbyBackupPayout({
    sb,
    trip: standbyTrip,
    stripe: mockStripe,
    connectAccountId: 'acct_backup_100',
  })
  assert.equal(realSuccess.ok, true)
  assert.equal(realSuccess.payout.status, 'paid')
  assert.equal(realSuccess.payout.stripeTransferId, 'tr_standby_100')
  assert.equal(transferCalls[0].payload.amount, 1000)
  assert.equal(transferCalls[0].payload.destination, 'acct_backup_100')
  assert.equal(transferCalls[0].opts.idempotencyKey, 'payout-backup:t_standby:0')
  assert.equal(sb._tripStore.get('t_standby').metadata.backup_standby_payout.status, 'paid')
  assert.equal(sb._upsertedBackupPayouts.length, 2)
  assert.equal(sb._upsertedBackupPayouts[1].status, 'paid')
  assert.equal(sb._upsertedBackupPayouts[1].role, 'standby')

  // Idempotent when called again after payment
  const idempotent = await attemptStandbyBackupPayout({
    trip: { ...standbyTrip, metadata: { ...standbyTrip.metadata, backup_standby_payout: realSuccess.payout } },
    stripe: mockStripe,
  })
  assert.equal(idempotent.ok, true)
  assert.equal(idempotent.idempotent, true)
})

test('attemptCancelFeePayout handles missing cancel fee, dry-run, and Stripe transfers', async () => {
  const plainTrip = { id: 't_plain', fare_cents: 0 }
  assert.equal(await attemptCancelFeePayout({ trip: plainTrip }), null)

  const cancelTrip = {
    id: 't_cancel',
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1500,
        cancelFeeDriverId: 'd_primary_canceled',
        cancelFeeCents: 1500,
      },
    },
  }

  // Dry run
  const dry = await attemptCancelFeePayout({ trip: cancelTrip, dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.payout.driverId, 'd_primary_canceled')
  assert.equal(dry.payout.amountCents, 1500)
  assert.equal(dry.payout.role, 'cancel_fee')

  // Real attempt
  let cancelCalls = []
  const mockStripe = {
    transfers: {
      create: async (payload, opts) => {
        cancelCalls.push({ payload, opts })
        return { id: 'tr_cancel_99' }
      },
    },
  }
  const sb = fakeSb({ trips: [cancelTrip] })
  const res = await attemptCancelFeePayout({
    sb,
    trip: cancelTrip,
    stripe: mockStripe,
    connectAccountId: 'acct_primary_canceled',
  })
  assert.equal(res.ok, true)
  assert.equal(res.payout.status, 'paid')
  assert.equal(cancelCalls[0].opts.idempotencyKey, 'payout-cancel:t_cancel:0')
  assert.equal(sb._tripStore.get('t_cancel').metadata.backup_cancel_payout.status, 'paid')
  assert.equal(sb._upsertedBackupPayouts.some((p) => p.role === 'cancel_fee'), true)

  // Idempotent when called again
  const paidAgain = await attemptCancelFeePayout({
    trip: { ...cancelTrip, metadata: { ...cancelTrip.metadata, backup_cancel_payout: res.payout } },
  })
  assert.equal(paidAgain.ok, true)
  assert.equal(paidAgain.idempotent, true)
})

test('attemptSwitchFeePayout handles missing switch plan, dry-run, and Stripe transfers', async () => {
  const plainTrip = { id: 't_plain' }
  assert.equal(await attemptSwitchFeePayout({ trip: plainTrip }), null)

  const switchTrip = {
    id: 't_switch',
    metadata: {
      backup_queue: {
        enabled: true,
        bonusCents: 1000,
        backupBonusRedirected: true,
        switchFeeDriverId: 'd_switched_off',
        switchFeeCents: 1000,
      },
    },
  }

  // Dry run
  const dry = await attemptSwitchFeePayout({ trip: switchTrip, dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.payout.role, 'switch_fee')
  assert.equal(dry.payout.amountCents, 1000)

  // Real attempt
  let switchCalls = []
  const mockStripe = {
    transfers: {
      create: async (payload, opts) => {
        switchCalls.push({ payload, opts })
        return { id: 'tr_switch_88' }
      },
    },
  }
  const sb = fakeSb({ trips: [switchTrip] })
  const res = await attemptSwitchFeePayout({
    sb,
    trip: switchTrip,
    stripe: mockStripe,
    connectAccountId: 'acct_switched_off',
  })
  assert.equal(res.ok, true)
  assert.equal(res.payout.status, 'paid')
  assert.equal(switchCalls[0].opts.idempotencyKey, 'payout-switch:t_switch:0')
  assert.equal(sb._tripStore.get('t_switch').metadata.backup_switch_payout.status, 'paid')
  assert.equal(sb._upsertedBackupPayouts.some((p) => p.role === 'switch_fee'), true)

  // Idempotent
  const paidAgain = await attemptSwitchFeePayout({
    trip: { ...switchTrip, metadata: { ...switchTrip.metadata, backup_switch_payout: res.payout } },
  })
  assert.equal(paidAgain.ok, true)
  assert.equal(paidAgain.idempotent, true)
})

test('loadConnectAccount retrieves Stripe account and handles fallbacks and nulls', async () => {
  assert.equal(await loadConnectAccount(null, 'd_1'), null)
  assert.equal(await loadConnectAccount({}, null), null)

  const sb = fakeSb({
    profiles: [
      { id: 'd_acc', stripe_account_id: 'acct_primary_stripe' },
      { id: 'd_conn', stripe_account_id: null, stripe_connect_id: 'acct_legacy_connect' },
      { id: 'd_none' },
    ],
  })

  assert.equal(await loadConnectAccount(sb, 'd_acc'), 'acct_primary_stripe')
  assert.equal(await loadConnectAccount(sb, 'd_conn'), 'acct_legacy_connect')
  assert.equal(await loadConnectAccount(sb, 'd_none'), null)
  assert.equal(await loadConnectAccount(sb, 'd_nonexistent'), null)
})

test('writePayout and enqueueAndAttemptPayout validate input and persist records', async () => {
  assert.deepEqual(await writePayout(null, { id: 't_1' }, {}), { error: 'no_trip' })
  assert.deepEqual(await writePayout({}, null, {}), { error: 'no_trip' })

  const trip = { id: 't_persist', driver_id: 'd_persist', fare_cents: 4000 }
  const sb = fakeSb({ trips: [trip] })
  const payout = {
    amountCents: 3200,
    status: 'paid',
    attempts: 1,
    stripeTransferId: 'tr_persist_1',
  }
  const wrote = await writePayout(sb, trip, payout)
  assert.equal(wrote.error, null)
  assert.equal(sb._tripStore.get('t_persist').metadata.payout.amountCents, 3200)
  assert.equal(sb._upsertedPayouts.length, 1)
  assert.equal(sb._upsertedPayouts[0].driver_id, 'd_persist')
  assert.equal(sb._upsertedPayouts[0].stripe_transfer_id, 'tr_persist_1')

  // enqueueAndAttemptPayout
  const enqueueTrip = { id: 't_enqueue', driver_id: 'd_enqueue', fare_cents: 5000 }
  const sb2 = fakeSb({ trips: [enqueueTrip] })
  const mockStripe = {
    transfers: {
      create: async () => ({ id: 'tr_enqueue_2' }),
    },
  }
  const enqResult = await enqueueAndAttemptPayout({
    sb: sb2,
    stripe: mockStripe,
    trip: enqueueTrip,
    connectAccountId: 'acct_enqueue',
  })
  assert.equal(enqResult.ok, true)
  assert.equal(enqResult.payout.status, 'paid')
  assert.equal(sb2._tripStore.get('t_enqueue').metadata.payout.status, 'paid')
  assert.equal(sb2._upsertedPayouts.length, 1)
})

