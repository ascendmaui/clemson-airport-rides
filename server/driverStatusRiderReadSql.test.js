import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261007130000_driver_status_rider_location_read.sql', import.meta.url),
  'utf8',
)

const rider = '00000000-0000-0000-0000-00000000000a'
const otherRider = '00000000-0000-0000-0000-00000000000b'
const driver = '00000000-0000-0000-0000-000000000001'
const otherDriver = '00000000-0000-0000-0000-000000000002'
const trip = '00000000-0000-0000-0000-000000000010'

test('the presence read migration adds a rider policy and does not enable RLS', () => {
  assert.match(migration, /driver_status_assigned_rider_read/)
  assert.match(migration, /trip_driver_locations is empty/)
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/i)
  assert.doesNotMatch(migration, /GRANT SELECT/i)
})

test('an assigned rider can read only that driver during an active trip', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated nologin;
    create table public.trips (
      id uuid primary key,
      rider_id uuid,
      driver_id uuid,
      status text
    );
    create table public.driver_status (
      driver_id uuid primary key,
      lat double precision,
      lng double precision,
      location_updated_at timestamptz,
      online boolean,
      expo_push_token text
    );
    insert into public.driver_status values
      ('${driver}', 34.68, -82.83, now(), true, 'secret-token'),
      ('${otherDriver}', 1, 2, now(), true, 'other-secret');
    insert into public.trips values
      ('${trip}', '${rider}', '${driver}', 'accepted'),
      ('00000000-0000-0000-0000-000000000011', '${otherRider}', '${otherDriver}', 'in_progress'),
      ('00000000-0000-0000-0000-000000000012', '${rider}', '${otherDriver}', 'searching');
    alter table public.driver_status enable row level security;
    grant select on public.driver_status to authenticated;
    grant select on public.trips to authenticated;
  `)
  await db.exec(migration)
  await db.exec(migration)

  const policies = await db.query(`
    select polname from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'driver_status'
  `)
  assert.deepEqual(policies.rows.map((row) => row.polname), ['driver_status_assigned_rider_read'])

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [rider])
  await db.exec('set role authenticated')
  const visible = await db.query('select driver_id::text as driver_id, expo_push_token from public.driver_status order by driver_id')
  assert.deepEqual(visible.rows.map((row) => row.driver_id), [driver])
  await db.exec('reset role')

  await db.query('update public.trips set status = $2 where id = $1', [trip, 'completed'])
  await db.exec('set role authenticated')
  const after = await db.query('select count(*)::int as n from public.driver_status')
  assert.equal(after.rows[0].n, 0)
})
