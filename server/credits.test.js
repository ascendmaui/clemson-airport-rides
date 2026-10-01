import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryCreditStore, supabaseCreditStore } from './credits.js'

test('memoryCreditStore manages balances and debits in memory', async () => {
  const store = memoryCreditStore({ user_1: 2500 }) // $25.00 initial balance

  const initial = await store.getCredits('user_1')
  assert.equal(initial.balanceCents, 2500)
  assert.equal(initial.unavailable, false)

  // Top up +$10.00
  const topUp = await store.applyCredits('user_1', 1000, { kind: 'top_up' })
  assert.equal(topUp.ok, true)
  assert.equal(topUp.balanceCents, 3500)

  // Debit -$15.00
  const debit = await store.applyCredits('user_1', -1500, { kind: 'ride_payment' })
  assert.equal(debit.ok, true)
  assert.equal(debit.balanceCents, 2000)

  // Insufficient credits debit (-$50.00)
  const overDebit = await store.applyCredits('user_1', -5000, { kind: 'ride_payment' })
  assert.equal(overDebit.ok, false)
  assert.equal(overDebit.code, 'credits_insufficient')
  assert.equal(overDebit.balanceCents, 2000, 'Balance unmodified after rejection')
})

test('memoryCreditStore honors idempotency keys for duplicate transactions', async () => {
  const store = memoryCreditStore({ user_2: 1000 })
  const meta = { idempotencyKey: 'idemp_tx_123', kind: 'ride_payment' }

  const first = await store.applyCredits('user_2', -500, meta)
  assert.equal(first.ok, true)
  assert.equal(first.balanceCents, 500)
  assert.equal(first.duplicate, undefined)

  // Re-run with identical idempotencyKey
  const second = await store.applyCredits('user_2', -500, meta)
  assert.equal(second.ok, true)
  assert.equal(second.duplicate, true)
  assert.equal(second.balanceCents, 500, 'Balance must not debit twice')
})

test('supabaseCreditStore safely reports unavailable when client or user is null', async () => {
  const store = supabaseCreditStore(null)

  const balance = await store.getCredits(null)
  assert.equal(balance.unavailable, true)
  assert.equal(balance.balanceCents, 0)

  const apply = await store.applyCredits(null, 500)
  assert.equal(apply.ok, false)
  assert.equal(apply.code, 'credits_unavailable')
})

test('supabaseCreditStore reads from credit_accounts table', async () => {
  const mockSb = {
    from: (table) => {
      assert.equal(table, 'credit_accounts')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { balance_cents: 4500 },
              error: null,
            }),
          }),
        }),
      }
    },
  }

  const store = supabaseCreditStore(mockSb)
  const res = await store.getCredits('usr_sb_1')
  assert.equal(res.balanceCents, 4500)
  assert.equal(res.unavailable, false)
})

test('supabaseCreditStore falls back to profiles table when credit_accounts table is missing', async () => {
  const mockSb = {
    from: (table) => {
      if (table === 'credit_accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'relation credit_accounts does not exist' },
              }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { credit_balance_cents: 1200 },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const store = supabaseCreditStore(mockSb)
  const res = await store.getCredits('usr_sb_2')
  assert.equal(res.balanceCents, 1200)
  assert.equal(res.unavailable, false)
})

test('supabaseCreditStore applies credit deltas via apply_credit_delta RPC', async () => {
  let rpcParams = null
  const mockSb = {
    rpc: async (name, params) => {
      assert.equal(name, 'apply_credit_delta')
      rpcParams = params
      return {
        data: { ok: true, balance_cents: 3000, duplicate: false },
        error: null,
      }
    },
  }

  const store = supabaseCreditStore(mockSb)
  const res = await store.applyCredits('usr_rpc', 1000, {
    kind: 'bonus',
    tripId: 'trip_10',
    idempotencyKey: 'key_abc',
  })

  assert.equal(res.ok, true)
  assert.equal(res.balanceCents, 3000)
  assert.equal(rpcParams.p_user_id, 'usr_rpc')
  assert.equal(rpcParams.p_delta_cents, 1000)
  assert.equal(rpcParams.p_kind, 'bonus')
  assert.equal(rpcParams.p_trip_id, 'trip_10')
  assert.equal(rpcParams.p_idempotency_key, 'key_abc')
})
