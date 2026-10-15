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

function lotsSb(result, seen = []) {
  const api = {
    select(cols) { seen.push(['select', cols]); return api },
    eq(col, val) { seen.push(['eq', col, val]); return api },
    gt(col, val) { seen.push(['gt', col, val]); return api },
    then(resolve) { resolve(result) },
  }
  return {
    from: (table) => {
      seen.push(['from', table])
      assert.equal(table, 'rider_credit_lots')
      return api
    },
  }
}

test('supabaseCreditStore reads the balance from available rider_credit_lots only', async () => {
  const seen = []
  const store = supabaseCreditStore(lotsSb({ data: [{ remaining_cents: 100000000 }, { remaining_cents: 4500 }], error: null }, seen))
  const res = await store.getCredits('usr_sb_1')
  assert.equal(res.balanceCents, 100004500)
  assert.equal(res.unavailable, false)
  assert.ok(seen.some((s) => s[0] === 'eq' && s[1] === 'status' && s[2] === 'available'))
  assert.ok(seen.some((s) => s[0] === 'eq' && s[1] === 'profile_id' && s[2] === 'usr_sb_1'))
})

test('supabaseCreditStore never reads credit_accounts or profiles, and a failed read is unavailable', async () => {
  const store = supabaseCreditStore(lotsSb({ data: null, error: { message: 'timeout' } }))
  const res = await store.getCredits('usr_sb_2')
  assert.equal(res.balanceCents, 0)
  assert.equal(res.unavailable, true)
})

test('supabaseCreditStore refuses the change when the RPC fails (no fallback write)', async () => {
  let fromCalled = false
  const store = supabaseCreditStore({
    rpc: async () => ({ data: null, error: { message: 'function apply_credit_delta does not exist' } }),
    from: () => { fromCalled = true; throw new Error('no direct table writes') },
  })
  const res = await store.applyCredits('usr_rpc', -500, { idempotencyKey: 'k1' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'credits_unavailable')
  assert.equal(fromCalled, false)
})

test('supabaseCreditStore passes through insufficient and idempotency_conflict codes', async () => {
  for (const code of ['credits_insufficient', 'idempotency_conflict']) {
    const store = supabaseCreditStore({ rpc: async () => ({ data: { ok: false, code, balance_cents: 52 }, error: null }) })
    const res = await store.applyCredits('usr_rpc', -500, { idempotencyKey: 'k2' })
    assert.equal(res.ok, false)
    assert.equal(res.code, code)
    assert.equal(res.balanceCents, 52)
  }
})

test('memoryCreditStore rejects a reused idempotency key with a different amount or rider', async () => {
  const store = memoryCreditStore({ a: 1000, b: 1000 })
  assert.equal((await store.applyCredits('a', -100, { idempotencyKey: 'x' })).ok, true)
  assert.equal((await store.applyCredits('a', -100, { idempotencyKey: 'x' })).duplicate, true)
  assert.equal((await store.applyCredits('a', -200, { idempotencyKey: 'x' })).code, 'idempotency_conflict')
  assert.equal((await store.applyCredits('b', -100, { idempotencyKey: 'x' })).code, 'idempotency_conflict')
  assert.equal((await store.getCredits('a')).balanceCents, 900)
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
