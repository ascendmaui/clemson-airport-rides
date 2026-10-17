import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261015170000_peak_pricing_pool.sql', import.meta.url),
  'utf8',
)

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'
const D1 = '44444444-4444-4444-8444-444444444444'

async function harness() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role pool_admin nologin;
    grant authenticated to pool_admin;
    create function public.is_admin() returns boolean language sql stable as $$ select current_user = 'pool_admin' $$;
    create table public.trips (id uuid primary key default gen_random_uuid(), fare_cents integer, metadata jsonb, fare_breakdown jsonb);
    grant select, insert on public.trips to authenticated, anon, service_role;
  `)
  await db.exec(migration)
  await db.exec(migration) // idempotent
  return db
}

const balance = async (db) => Number((await db.query('select balance_cents from public.peak_pool_balance()')).rows[0].balance_cents)

test('pool balance never goes negative; draws are capped and idempotent', async () => {
  const db = await harness()
  try {
    await db.exec('set role service_role')
    assert.equal(await balance(db), 0)
    assert.equal((await db.query(`select granted_cents from public.peak_pool_draw('${T1}', '${D1}', 500)`)).rows[0].granted_cents, 0)
    assert.equal((await db.query(`select recorded_cents from public.peak_pool_contribute('${T2}', 139, 100000)`)).rows[0].recorded_cents, 139)
    assert.equal((await db.query(`select recorded_cents from public.peak_pool_contribute('${T2}', 139, 100000)`)).rows[0].recorded_cents, 139, 'retry does not double count')
    assert.equal(await balance(db), 139)
    assert.equal((await db.query(`select granted_cents from public.peak_pool_draw('${T3}', '${D1}', 836)`)).rows[0].granted_cents, 139)
    assert.equal((await db.query(`select granted_cents from public.peak_pool_draw('${T3}', '${D1}', 836)`)).rows[0].granted_cents, 139, 'retry returns the first grant')
    assert.equal(await balance(db), 0)
    const rows = await db.query('select kind, amount_cents, requested_cents from public.peak_pool_ledger order by created_at, kind')
    assert.deepEqual(rows.rows.map((r) => [r.kind, r.amount_cents, r.requested_cents]).sort(), [['contribution', 139, 139], ['draw', 139, 836]])
  } finally {
    await db.close()
  }
})

test('contributions pause at the ceiling', async () => {
  const db = await harness()
  try {
    await db.exec('set role service_role')
    assert.equal((await db.query(`select recorded_cents from public.peak_pool_contribute('${T1}', 600, 1000)`)).rows[0].recorded_cents, 600)
    assert.equal((await db.query(`select recorded_cents from public.peak_pool_contribute('${T2}', 600, 1000)`)).rows[0].recorded_cents, 400)
    assert.equal((await db.query(`select recorded_cents from public.peak_pool_contribute('${T3}', 600, 1000)`)).rows[0].recorded_cents, 0)
    assert.equal(await balance(db), 1000)
    await assert.rejects(() => db.query(`insert into public.peak_pool_ledger (kind, amount_cents) values ('draw', -5)`), /check/i)
  } finally {
    await db.close()
  }
})

test('RLS: anon has nothing, riders and drivers cannot read or call, admins can read', async () => {
  const db = await harness()
  try {
    const rls = await db.query(`select relrowsecurity from pg_class where relname = 'peak_pool_ledger'`)
    assert.equal(rls.rows[0].relrowsecurity, true)
    await db.exec('set role anon')
    await assert.rejects(() => db.query('select * from public.peak_pool_ledger'), /permission denied/i)
    await assert.rejects(() => db.query(`select * from public.peak_pool_draw('${T1}', null, 100)`), /permission denied/i)
    await db.exec('reset role')
    await db.exec('set role authenticated')
    assert.equal((await db.query('select count(*)::int as n from public.peak_pool_ledger')).rows[0].n, 0)
    await assert.rejects(() => db.query(`select * from public.peak_pool_contribute('${T1}', 100, null)`), /permission denied/i)
    await assert.rejects(() => db.query(`insert into public.peak_pool_ledger (kind, amount_cents) values ('adjustment_in', 100)`), /permission denied/i)
    await db.exec('reset role')
    await db.exec('set role service_role')
    await db.query(`select * from public.peak_pool_contribute('${T1}', 100, null)`)
    await db.exec('reset role')
    await db.exec('set role pool_admin')
    assert.equal((await db.query('select count(*)::int as n from public.peak_pool_ledger')).rows[0].n, 1)
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})

test('client-inserted trips cannot seed peak payout data', async () => {
  const db = await harness()
  try {
    await db.exec('set role authenticated')
    await db.query(`insert into public.trips (id, fare_cents, metadata, fare_breakdown) values ('${T1}', 885, '{"peak_pricing":{"settled":true,"kind":"peak","driverEarningsCents":99999},"keep":1}', '{"peak_surcharge_bps":5000,"peak_base_fare_cents":1,"surge_multiplier":1.5}')`)
    await db.exec('reset role')
    const row = (await db.query(`select metadata, fare_breakdown from public.trips where id = '${T1}'`)).rows[0]
    assert.deepEqual(row.metadata, { keep: 1 })
    assert.deepEqual(row.fare_breakdown, { surge_multiplier: 1.5 })
    await db.exec('set role service_role')
    await db.query(`insert into public.trips (id, fare_cents, fare_breakdown) values ('${T2}', 885, '{"peak_surcharge_bps":5000}')`)
    await db.exec('reset role')
    assert.equal((await db.query(`select fare_breakdown from public.trips where id = '${T2}'`)).rows[0].fare_breakdown.peak_surcharge_bps, 5000)
  } finally {
    await db.close()
  }
})
