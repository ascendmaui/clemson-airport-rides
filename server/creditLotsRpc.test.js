import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { debitLots } from './creditLots.js'

function rpcSb(result) {
  const calls = []
  return {
    calls,
    rpc: async (name, params) => { calls.push({ name, params }); return typeof result === 'function' ? result(params) : result },
    from: () => { throw new Error('debitLots must not write tables directly when rpc exists') },
  }
}

test('debitLots sends all lots in one atomic RPC with a key derived from the note', async () => {
  const sb = rpcSb({ data: { ok: true, duplicate: false, balance_cents: 100 }, error: null })
  const debits = [{ lotId: 'l1', debitCents: 500, discountCents: 50 }, { lotId: 'l2', debitCents: 200 }]
  const applied = await debitLots(sb, { profileId: 'r1', debits, note: 'airport:t1', tripId: 't1' })
  assert.deepEqual(applied, debits)
  assert.equal(sb.calls.length, 1)
  const { name, params } = sb.calls[0]
  assert.equal(name, 'debit_credit_lots')
  assert.equal(params.p_idempotency_key, 'lots:airport:t1')
  assert.deepEqual(params.p_debits, [
    { lot_id: 'l1', debit_cents: 500, discount_cents: 50 },
    { lot_id: 'l2', debit_cents: 200, discount_cents: 0 },
  ])
})

test('debitLots treats a replayed key as already applied (no second debit)', async () => {
  const sb = rpcSb({ data: { ok: true, duplicate: true, balance_cents: 100 }, error: null })
  const debits = [{ lotId: 'l1', debitCents: 500 }]
  assert.deepEqual(await debitLots(sb, { profileId: 'r1', debits, note: 'friend:x:y', idempotencyKey: 'k' }), debits)
  assert.equal(sb.calls[0].params.p_idempotency_key, 'k')
})

test('debitLots throws (nothing applied) on stale lots, missing lots and key conflicts', async () => {
  await assert.rejects(debitLots(rpcSb({ data: null, error: { message: 'credit_balance_changed' } }), { profileId: 'r', debits: [{ lotId: 'l', debitCents: 1 }] }), /retry the charge/)
  await assert.rejects(debitLots(rpcSb({ data: null, error: { message: 'credit_lot_missing' } }), { profileId: 'r', debits: [{ lotId: 'l', debitCents: 1 }] }), /Credit lot missing/)
  await assert.rejects(debitLots(rpcSb({ data: { ok: false, code: 'idempotency_conflict' }, error: null }), { profileId: 'r', debits: [{ lotId: 'l', debitCents: 1 }], note: 'n' }), /different amount/)
})

test('debitLots skips the RPC when there is nothing to debit', async () => {
  const sb = rpcSb({ data: { ok: true }, error: null })
  assert.deepEqual(await debitLots(sb, { profileId: 'r', debits: [{ lotId: 'l', debitCents: 0 }] }), [])
  assert.equal(sb.calls.length, 0)
})

test('debit_credit_lots migration is atomic, idempotent, locked and service_role only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261015131500_debit_credit_lots_idempotent.sql', import.meta.url), 'utf8')
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('rider_credit:'/)
  assert.match(sql, /idempotency_conflict/)
  assert.match(sql, /for update/)
  assert.match(sql, /raise exception 'credit_balance_changed'/)
  assert.match(sql, /revoke all on function public\.debit_credit_lots\(uuid, jsonb, uuid, text, text\) from public, anon, authenticated;/)
  assert.match(sql, /grant execute on function public\.debit_credit_lots\(uuid, jsonb, uuid, text, text\) to service_role;/)
  assert.doesNotMatch(sql, /drop table|delete from|credit_accounts/i)
})
