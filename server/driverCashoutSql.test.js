import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261012120000_driver_instant_cashout.sql', import.meta.url), 'utf8')
const D = '11111111-1111-1111-1111-111111111111'

async function boot() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create role authenticated; create role anon; create role service_role;
    create table public.trips (id uuid primary key default gen_random_uuid(), driver_id uuid, status text, metadata jsonb);
    create table public.driver_payouts (trip_id uuid primary key, driver_id uuid, amount_cents int, status text,
      stripe_transfer_id text, last_error text, updated_at timestamptz);
  `)
  await db.exec(sql)
  const pay = (cents, status = 'pending', extra = {}) => JSON.stringify({ ...extra, payout: { status, amountCents: cents } })
  await db.query(`insert into trips (driver_id, status, metadata) values
    ($1,'completed',$2),($1,'completed',$3),($1,'cancelled_wait',$4),($1,'completed',$5),($1,'completed',$6)`,
  [D, pay(4000), pay(1200, 'failed'), pay(160), pay(9999, 'paid'), pay(5000, 'pending', { e2e_test: true })])
  await db.exec(`insert into driver_payouts (trip_id, driver_id, amount_cents, status) select id, driver_id, 0, metadata->'payout'->>'status' from trips`)
  return db
}

test('migration is additive and locks RPCs to service_role', () => {
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate|alter table public\.(trips|driver_payouts))\b/i)
  assert.match(sql, /create unique index if not exists driver_cashouts_one_per_ny_day[\s\S]*where status <> 'failed'/i)
  assert.match(sql, /revoke all on function public\.claim_driver_cashout[\s\S]*from authenticated/i)
})

test('claim sums due payouts, ledger math balances, and a second claim the same day is refused', async () => {
  const db = await boot()
  const { rows: [c] } = await db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D])
  assert.equal(c.gross_cents, 5360)
  assert.equal(c.fee_cents, 81)
  assert.equal(c.net_cents, c.gross_cents - c.fee_cents)
  assert.equal(c.trip_ids.length, 3)
  const { rows: claimed } = await db.query(`select count(*)::int n from trips where metadata->'payout'->>'status'='cashout_pending'`)
  assert.equal(claimed[0].n, 3)
  await assert.rejects(db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D]), /already_cashed_out_today/)
  // Even a direct insert bypassing the RPC hits the unique index.
  await assert.rejects(db.query(`insert into driver_cashouts (driver_id) values ($1)`, [D]), /unique|duplicate/i)
  await db.close()
})

test('concurrent claims: exactly one wins', async () => {
  const db = await boot()
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D])))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const { rows } = await db.query(`select count(*)::int n from driver_cashouts`)
  assert.equal(rows[0].n, 1)
  await db.close()
})

test('settle ok marks trips paid; settle failed releases trips and frees the day', async () => {
  const db = await boot()
  const { rows: [c] } = await db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D])
  await db.query(`select settle_driver_cashout($1, false, 'failed', null, null, null, null, 'boom')`, [c.id])
  const { rows: back } = await db.query(`select count(*)::int n from trips where metadata->'payout'->>'status' in ('pending','failed') and not (metadata ? 'e2e_test')`)
  assert.equal(back[0].n, 3)
  const { rows: [c2] } = await db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D])
  await db.query(`select settle_driver_cashout($1, true, 'paid', 'instant', 'tr_1', 'po_1', null, null)`, [c2.id])
  const { rows: paid } = await db.query(`select metadata->'payout' p from trips where id = any($1)`, [c2.trip_ids])
  for (const { p } of paid) { assert.equal(p.status, 'paid'); assert.equal(p.stripeTransferId, 'tr_1'); assert.equal(p.cashoutId, c2.id) }
  const { rows: dp } = await db.query(`select count(*)::int n from driver_payouts where status='paid' and stripe_transfer_id='tr_1'`)
  assert.equal(dp[0].n, 3)
  await assert.rejects(db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D]), /already_cashed_out_today/)
  await db.close()
})

test('zero balance raises zero_balance and records nothing', async () => {
  const db = await boot()
  await db.exec(`update trips set metadata = jsonb_set(metadata, '{payout,status}', '"paid"')`)
  await assert.rejects(db.query(`select * from claim_driver_cashout($1, 150, 50)`, [D]), /zero_balance/)
  const { rows } = await db.query(`select count(*)::int n from driver_cashouts`)
  assert.equal(rows[0].n, 0)
  await db.close()
})
