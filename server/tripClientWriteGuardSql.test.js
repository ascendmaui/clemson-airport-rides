import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261009140000_trips_client_write_guard.sql', import.meta.url), 'utf8')
const driver = '00000000-0000-0000-0000-000000000001'
const rider = '00000000-0000-0000-0000-000000000002'

async function as(db, role, uid, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ''])
  await db.exec(`set role ${role}`)
  try { return await db.query(sql, params) } finally { await db.exec('reset role') }
}

test('real trip client guard protects money and status with production update policies', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create type public.trip_status as enum ('searching','offered','accepted','arriving','in_progress','completed','canceled','scheduled','canceled_midride','arrived','cancelled_wait');
    create table public.trips (
      id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid,
      status public.trip_status, scheduled_for timestamptz, pickup_at timestamptz,
      accepted_at timestamptz, canceled_at timestamptz, fare_cents integer,
      driver_earnings_cents integer, platform_fee_cents integer, metadata jsonb,
      driver_wait_earnings_cents integer, wait_fee_cents integer, cancel_fee_cents integer, switch_fee_cents integer
    );
    create table public.driver_status (driver_id uuid primary key, online boolean);
    insert into driver_status values ('${driver}', true);
    grant select on driver_status to authenticated;
    grant select, insert, update on trips to anon, authenticated, service_role;
    alter table trips enable row level security;
    create policy trips_select on trips for select to authenticated using (
      auth.uid() = rider_id or auth.uid() = driver_id or (driver_id is null and status in ('searching','offered')
      and exists (select 1 from driver_status where driver_id = auth.uid() and online = true))
    );
    create policy trips_insert on trips for insert to authenticated with check (rider_id = auth.uid());
    create policy trips_update_participants on trips for update to public using (auth.uid() = rider_id or auth.uid() = driver_id);
    create policy trips_online_driver_claim on trips for update to authenticated
      using (status in ('searching','offered') and driver_id is null and exists (
        select 1 from driver_status ds where ds.driver_id = auth.uid() and ds.online = true))
      with check (driver_id = auth.uid() and status in ('accepted','offered'));
    create policy trips_driver_progress on trips for update to authenticated
      using (driver_id = auth.uid()) with check (driver_id = auth.uid() and status in ('accepted','arriving','in_progress','completed','canceled'));
  `)
  await db.exec(migration)
  let seq = 0
  const seed = async ({ status = 'accepted', assigned = driver, metadata = { payout: { status: 'pending' }, driver_payout_cents: 800 }, scheduled = false } = {}) => {
    const id = `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`
    await db.query(`insert into trips (id, rider_id, driver_id, status, fare_cents, driver_earnings_cents, platform_fee_cents, metadata, scheduled_for)
      values ($1, $2, $3, $4, 1000, 800, 200, $5, $6)`, [id, rider, assigned, status, metadata, scheduled ? '2026-10-10T12:00:00Z' : null])
    return id
  }
  const row = async (id) => (await db.query('select * from trips where id = $1', [id])).rows[0]
  const update = (id, uid, sql) => as(db, 'authenticated', uid, `update trips set ${sql} where id = $1 returning *`, [id])

  await t.test('driver monetary and payout changes are silently reverted', async () => {
    const id = await seed()
    const before = await row(id)
    await update(id, driver, `fare_cents = 99999, driver_earnings_cents = 99999, platform_fee_cents = 0,
      metadata = '{"payout":{"status":"succeeded","amountCents":99999},"driver_payout_cents":99999}'`)
    assert.deepEqual(await row(id), before)
  })
  await t.test('driver cannot complete or cancel directly; rider cannot start or complete', async () => {
    for (const [uid, status] of [[driver, 'completed'], [driver, 'canceled'], [rider, 'in_progress'], [rider, 'completed']]) {
      const id = await seed({ status: status === 'completed' ? 'in_progress' : 'arrived' })
      await assert.rejects(() => update(id, uid, `status = '${status}'`), /trip_transition_not_allowed/)
    }
  })
  await t.test('rider cancellation remains allowed', async () => {
    for (const status of ['scheduled', 'searching', 'offered', 'accepted']) {
      const id = await seed({ status, scheduled: status === 'scheduled' || status === 'accepted' })
      await update(id, rider, "status = 'canceled'")
      assert.equal((await row(id)).status, 'canceled')
      assert.ok((await row(id)).canceled_at)
    }
  })
  await t.test('claim locks exclusive and pool economics from stored offer metadata', async () => {
    for (const [phase, status, bps, net] of [['exclusive', 'searching', 8000, 800], ['pool', 'offered', 7000, 700]]) {
      const id = await seed({ status, assigned: null, metadata: { offer_phase: phase, offer_share_bps: bps, other_key: 'preserved' } })
      await update(id, driver, `status = 'accepted', driver_id = '${driver}', fare_cents = 99999, driver_earnings_cents = 99999,
        metadata = '{"driver_share_bps":10000,"driver_payout_cents":99999}'`)
      const claimed = await row(id)
      assert.equal(claimed.driver_id, driver)
      assert.equal(claimed.fare_cents, 1000)
      assert.equal(claimed.driver_earnings_cents, net)
      assert.equal(claimed.platform_fee_cents, 1000 - net)
      assert.deepEqual(claimed.metadata, { offer_phase: phase, offer_share_bps: bps, other_key: 'preserved', driver_share_bps: bps, driver_payout_cents: net, accepted_offer_phase: phase })
    }
  })
  await t.test('legacy driver progress and completed no-op remain allowed', async () => {
    const id = await seed()
    for (const status of ['arriving', 'arrived', 'in_progress']) {
      await update(id, driver, `status = '${status}'`)
      assert.equal((await row(id)).status, status)
    }
    const complete = await seed({ status: 'completed' })
    const before = await row(complete)
    await update(complete, driver, "status = 'completed', driver_earnings_cents = 99999")
    assert.deepEqual(await row(complete), before)
  })
  await t.test('service role bypasses the guard', async () => {
    const id = await seed()
    await as(db, 'service_role', null, `update trips set status = 'completed', fare_cents = 5, driver_earnings_cents = 99999, metadata = '{"payout":123}' where id = $1`, [id])
    const changed = await row(id)
    assert.equal(changed.status, 'completed')
    assert.equal(changed.driver_earnings_cents, 99999)
    assert.equal(changed.fare_cents, 5)
    assert.deepEqual(changed.metadata, { payout: 123 })
  })
  await t.test('authenticated insert strips all protected payout keys and fee fields', async () => {
    const metadata = Object.fromEntries(['payout','driver_payout_cents','driver_net_cents','payout_cents','driver_share_bps','accepted_offer_phase','platform_fee_cents','tiger_heat','boost_included_in_driver_net','backup_standby_payout'].map(key => [key, 99999]))
    metadata.other_key = 'preserved'
    const inserted = await as(db, 'authenticated', rider, `insert into trips (rider_id, status, metadata, driver_earnings_cents, platform_fee_cents, driver_wait_earnings_cents, wait_fee_cents, cancel_fee_cents, switch_fee_cents)
      values ($1, 'searching', $2, 99999, 99999, 99999, 99999, 99999, 99999) returning *`, [rider, metadata])
    const trip = inserted.rows[0]
    assert.deepEqual(trip.metadata, { other_key: 'preserved' })
    for (const key of ['driver_earnings_cents','platform_fee_cents','switch_fee_cents']) assert.equal(trip[key], null)
    for (const key of ['driver_wait_earnings_cents','wait_fee_cents','cancel_fee_cents']) assert.equal(trip[key], 0)
  })
})
