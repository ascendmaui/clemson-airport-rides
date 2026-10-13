import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261010090000_trip_status_notices.sql', import.meta.url), 'utf8')
const tokensSql = readFileSync(new URL('../supabase/migrations/20261009030000_driver_push_tokens.sql', import.meta.url), 'utf8')
const rider = '00000000-0000-0000-0000-00000000000a'
const driver = '00000000-0000-0000-0000-00000000000b'
const driver2 = '00000000-0000-0000-0000-00000000000c'

async function setup({ secret = 'cron-secret', failNet = false } = {}) {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    ${secret ? `insert into vault.decrypted_secrets values ('clemson_cron_secret', '${secret}');` : ''}
    create schema net;
    create table net.calls (id bigserial primary key, url text, headers jsonb);
    create function net.http_get(url text, headers jsonb, timeout_milliseconds int) returns bigint language plpgsql as $$
    declare v bigint; begin
      ${failNet ? "raise exception 'pg_net down';" : ''}
      insert into net.calls (url, headers) values (url, headers) returning id into v; return v; end $$;
    create type public.trip_status as enum ('searching','offered','accepted','arriving','in_progress','completed','canceled','scheduled','canceled_midride','arrived','cancelled_wait');
    create table public.trips (id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid, status public.trip_status,
      pickup_at timestamptz, scheduled_for timestamptz);
    insert into auth.users values ('${rider}'), ('${driver}'), ('${driver2}');
  `)
  await db.exec(tokensSql)
  await db.exec(sql)
  return db
}

const notices = async (db) => (await db.query('select kind, recipient_id, recipient_role, driver_id from trip_status_notices order by id')).rows
const calls = async (db) => (await db.query('select url, headers from net.calls order by id')).rows

test('status changes enqueue one notice per kind and driver, and poke the drain', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, status) values ($1, 'searching') returning id`, [rider])
  await db.query(`update trips set status='accepted', driver_id=$2 where id=$1`, [id, driver])
  await db.query(`update trips set status='arriving' where id=$1`, [id])
  await db.query(`update trips set status='arrived' where id=$1`, [id])
  await db.query(`update trips set status='in_progress' where id=$1`, [id])
  assert.deepEqual((await notices(db)).map((n) => [n.kind, n.recipient_role, n.recipient_id]), [
    ['driver_en_route', 'rider', rider],
    ['driver_arriving', 'rider', rider],
    ['arrive_prompt', 'driver', driver],
    ['driver_arrived', 'rider', rider],
  ])
  const pokes = await calls(db)
  assert.equal(pokes.length, 3)
  assert.equal(pokes[0].url, 'https://clemsonrides.com/api/driver?action=trip-sweeps&only=trip-status-notices')
  assert.equal(pokes[0].headers.Authorization, 'Bearer cron-secret')
})

test('a repeat status and a reassigned driver dedupe per driver', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, driver_id, status) values ($1, $2, 'accepted') returning id`, [rider, driver])
  await db.query(`update trips set status='arriving' where id=$1`, [id])
  await db.query(`update trips set status='accepted' where id=$1`, [id])
  await db.query(`update trips set status='arriving' where id=$1`, [id])
  await db.query(`update trips set status='searching', driver_id=null where id=$1`, [id])
  await db.query(`update trips set status='accepted', driver_id=$2 where id=$1`, [id, driver2])
  assert.deepEqual((await notices(db)).map((n) => [n.kind, n.driver_id]), [
    ['driver_arriving', driver], ['arrive_prompt', driver], ['driver_en_route', driver], ['driver_en_route', driver2],
  ])
})

test('scheduled rides accepted far ahead do not tell the rider the driver is on the way', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, status, pickup_at) values ($1, 'scheduled', now() + interval '2 days') returning id`, [rider])
  await db.query(`update trips set status='accepted', driver_id=$2 where id=$1`, [id, driver])
  assert.equal((await notices(db)).length, 0)
  await db.query(`update trips set pickup_at = now() + interval '20 minutes', status='arriving' where id=$1`, [id])
  assert.deepEqual((await notices(db)).map((n) => n.kind), ['driver_arriving', 'arrive_prompt'])
})

test('missing vault secret or a pg_net failure never blocks the trip update', async (t) => {
  for (const options of [{ secret: '' }, { failNet: true }]) {
    const db = await setup(options)
    t.after(() => db.close())
    const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, driver_id, status) values ($1, $2, 'accepted') returning id`, [rider, driver])
    await db.query(`update trips set status='arriving' where id=$1`, [id])
    assert.equal((await db.query('select status from trips where id=$1', [id])).rows[0].status, 'arriving')
    assert.equal((await calls(db)).length, 0)
  }
})

test('rider tokens are own-row only, and the outbox is service-role only', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const as = async (uid, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid])
    await db.exec('set role authenticated')
    try { return await db.query(query, params) } finally { await db.exec('reset role') }
  }
  await as(rider, `insert into rider_push_tokens (rider_id, token, platform) values ($1, 'ExponentPushToken[r]', 'ios')`, [rider])
  await assert.rejects(() => as(rider, `insert into rider_push_tokens (rider_id, token) values ($1, 'x')`, [driver]), /row-level security/)
  assert.equal((await as(driver, 'select * from rider_push_tokens')).rows.length, 0)
  assert.equal((await as(rider, 'select * from rider_push_tokens')).rows.length, 1)
  await assert.rejects(() => as(rider, 'select * from trip_status_notices'), /permission denied/)
  const { rows: [col] } = await db.query(`select column_default, is_nullable from information_schema.columns where table_name='driver_push_tokens' and column_name='features'`)
  assert.equal(col.is_nullable, 'NO')
  assert.match(sql, /-- Down:/)
})
