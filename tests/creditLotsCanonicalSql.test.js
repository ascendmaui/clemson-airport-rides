import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../supabase/migrations/20261015120000_credit_lots_canonical_bigint.sql', import.meta.url), 'utf8')
const fnStart = sql.indexOf('create function public.apply_credit_delta(')
const fnBody = sql.slice(fnStart, sql.indexOf('$$;', fnStart))

test('apply_credit_delta takes bigint and replaces the integer signature', () => {
  assert.match(sql, /drop function if exists public\.apply_credit_delta\(uuid, integer, text, uuid, text\);/)
  assert.match(fnBody, /p_delta_cents bigint/)
})

test('apply_credit_delta reads and writes lots only, never credit_accounts or profiles', () => {
  assert.match(fnBody, /public\.rider_credit_lots/)
  assert.doesNotMatch(fnBody, /credit_accounts/)
  assert.doesNotMatch(fnBody, /update public\.profiles/)
  assert.doesNotMatch(fnBody, /credit_balance_cents/)
})

test('apply_credit_delta locks per rider, honours idempotency and rejects key reuse', () => {
  assert.match(fnBody, /pg_advisory_xact_lock/)
  assert.match(fnBody, /idempotency_conflict/)
  assert.match(fnBody, /'duplicate', true/)
  assert.match(fnBody, /credits_insufficient/)
  assert.match(fnBody, /for update/)
})

test('apply_credit_delta is service_role only', () => {
  assert.match(sql, /revoke all on function public\.apply_credit_delta\(uuid, bigint, text, uuid, text\) from public, anon, authenticated;/)
  assert.match(sql, /grant execute on function public\.apply_credit_delta\(uuid, bigint, text, uuid, text\) to service_role;/)
})

test('balance columns are widened to bigint', () => {
  for (const col of ['credit_balance_cents', 'load_cents', 'remaining_cents', 'amount_cents', 'discount_cents', 'balance_cents', 'delta_cents', 'balance_after']) {
    assert.match(sql, new RegExp(`alter column ${col} type bigint`), col)
  }
})

test('profile balance is derived from lots and the migration verifies balances against a snapshot', () => {
  assert.match(sql, /create trigger profiles_credit_balance_derived/)
  assert.match(sql, /pg_trigger_depth\(\) <= 1/)
  assert.match(sql, /credit_balance_snapshot_20261015/)
  assert.match(sql, /credit balance verification failed/)
})

test('migration is additive: no drop table, no delete', () => {
  assert.doesNotMatch(sql, /drop table/i)
  assert.doesNotMatch(sql, /\bdelete from\b/i)
  assert.doesNotMatch(sql, /\btruncate\s+(table\s+)?public\./i)
})
