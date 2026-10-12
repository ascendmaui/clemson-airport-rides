import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { awardBonuses, payBonusLedger } from './perks.js'

test('ledger migration is additive with idempotent award key', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012130000_driver_perks_ledger_streaks.sql', import.meta.url), 'utf8')
  assert.match(sql, /unique \(kind, driver_id, ref\)/)
  assert.match(sql, /on conflict \(key\) do nothing/)
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate)\b/i)
})

test('awardBonuses upserts with ignoreDuplicates on the ledger key', async () => {
  let call
  const sb = { from: () => ({ upsert: async (rows, opts) => { call = { rows, opts }; return { error: null } } }) }
  await awardBonuses(sb, 'd1', [{ kind: 'streak_trips', ref: 'trip:t', amountCents: 500 }, { kind: 'x', ref: 'r', amountCents: 0 }])
  assert.equal(call.rows.length, 1)
  assert.deepEqual(call.opts, { onConflict: 'kind,driver_id,ref', ignoreDuplicates: true })
})

test('payBonusLedger pays each row once with its id as idempotency key', async () => {
  const rows = [
    { id: 'b1', driver_id: 'd1', kind: 'streak_days', amount_cents: 1500, attempts: 0, status: 'pending' },
    { id: 'b2', driver_id: 'd2', kind: 'referral', amount_cents: 2500, attempts: 0, status: 'pending' },
    { id: 'b3', driver_id: 'd1', kind: 'x', amount_cents: 100, attempts: 5, status: 'failed' },
  ]
  const updates = []
  const q = { select: () => q, in: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) }
  const sb = { from: () => ({ ...q, update: (patch) => ({ eq: (_c, id) => ({ in: async () => { updates.push({ id, patch }); return {} } }) }) }) }
  const transfers = []
  const stripe = { transfers: { create: async (p, o) => { transfers.push({ p, o }); return { id: `tr_${p.amount}` } } } }
  const res = await payBonusLedger(sb, stripe, { loadAccount: async (_sb, id) => (id === 'd1' ? 'acct_1' : null) })
  assert.deepEqual(res.map((r) => r.status), ['paid', 'failed'])
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].o.idempotencyKey, 'bonus:b1')
  assert.equal(updates.find((u) => u.id === 'b2').patch.last_error, 'no_connect_account')
})
