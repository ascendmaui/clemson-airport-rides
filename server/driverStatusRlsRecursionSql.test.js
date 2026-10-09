import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const readMigration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const original = readMigration('20261007130000_driver_status_rider_location_read.sql')
const migration = readMigration('20261009010000_fix_driver_status_rls_recursion.sql')

const rider = '00000000-0000-0000-0000-00000000000a'
const otherRider = '00000000-0000-0000-0000-00000000000b'
const driver = '00000000-0000-0000-0000-000000000001'
const assignedDriver = '00000000-0000-0000-0000-000000000002'
const unrelatedDriver = '00000000-0000-0000-0000-000000000003'
const activeTrip = '00000000-0000-0000-0000-000000000010'
const openTrip = '00000000-0000-0000-0000-000000000011'

async function as(db, role, userId, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

test('authenticated presence writes and trip reads reproduce recursion, then work after the real migration', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

    create table public.trips (id uuid primary key, rider_id uuid, driver_id uuid, status text);
    create table public.driver_status (driver_id uuid primary key, online boolean, lat double precision, lng double precision);
    insert into public.driver_status values
      ('${driver}', false, 34.68, -82.83),
      ('${assignedDriver}', false, 34.69, -82.84),
      ('${unrelatedDriver}', false, 1, 2);
    insert into public.trips values
      ('${activeTrip}', '${rider}', '${assignedDriver}', 'accepted'),
      ('${openTrip}', '${otherRider}', null, 'searching');
    alter table public.trips enable row level security;
    alter table public.driver_status enable row level security;
    grant select on public.trips, public.driver_status to anon, authenticated;
    grant update on public.trips to authenticated;
    grant insert, update on public.driver_status to authenticated;

    create policy trips_rider_select on public.trips for select to authenticated
      using (auth.uid() = rider_id or auth.uid() = driver_id);
    create policy trips_driver_open_select on public.trips for select to public
      using (status in ('searching', 'offered') and exists (
        select 1 from public.driver_status ds where ds.driver_id = auth.uid() and ds.online = true
      ));
    create policy trips_online_driver_claim on public.trips for update to authenticated
      using (status in ('searching', 'offered') and exists (
        select 1 from public.driver_status ds where ds.driver_id = auth.uid() and ds.online = true
      ));

    -- Driver self-access and public online presence reads predate the rider policy.
    create policy driver_status_self_select on public.driver_status for select to authenticated
      using (driver_id = auth.uid());
    create policy driver_status_self_insert on public.driver_status for insert to authenticated
      with check (driver_id = auth.uid());
    create policy driver_status_self_update on public.driver_status for update to authenticated
      using (driver_id = auth.uid()) with check (driver_id = auth.uid());
    create policy driver_status_online_select on public.driver_status for select to public
      using (online = true);
  `)
  await db.exec(original)

  const cases = [
    {
      name: 'driver upsert', userId: driver,
      sql: `insert into public.driver_status (driver_id, online, lat, lng) values ($1, true, 34.7, -82.8)
        on conflict (driver_id) do update set online = excluded.online, lat = excluded.lat, lng = excluded.lng
        returning driver_id, online, lat, lng`,
      params: [driver], expected: [{ driver_id: driver, online: true, lat: 34.7, lng: -82.8 }],
    },
    {
      name: 'driver own presence', userId: driver,
      sql: 'select driver_id, online from public.driver_status where driver_id = $1',
      params: [driver], expected: [{ driver_id: driver, online: true }],
    },
    {
      name: 'online driver open trips', userId: driver,
      sql: "select id from public.trips where status = 'searching'",
      params: [], expected: [{ id: openTrip }],
    },
    {
      name: 'rider own trips', userId: rider,
      sql: 'select id from public.trips where rider_id = $1',
      params: [rider], expected: [{ id: activeTrip }],
    },
    {
      name: 'rider offline driver presence', userId: rider,
      sql: 'select driver_id from public.driver_status where online = false order by driver_id',
      params: [], expected: [{ driver_id: assignedDriver }],
    },
  ]
  for (const query of cases) {
    await assert.rejects(
      () => as(db, 'authenticated', query.userId, () => db.query(query.sql, query.params)),
      /infinite recursion detected in policy for relation "(?:trips|driver_status)"/i,
      query.name,
    )
  }

  const otherPolicies = () => db.query(`
    select tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies where schemaname = 'public' and policyname <> 'driver_status_assigned_rider_read'
    order by tablename, policyname
  `)
  const before = await otherPolicies()
  await db.exec(migration)
  await db.exec(migration)
  assert.deepEqual((await otherPolicies()).rows, before.rows)

  for (const query of cases) {
    const result = await as(db, 'authenticated', query.userId, () => db.query(query.sql, query.params))
    assert.deepEqual(result.rows, query.expected, query.name)
  }

  // The helper uses the caller's rider id, including when called directly.
  const unrelated = await as(db, 'authenticated', otherRider, () => db.query(
    'select driver_id from public.driver_status where online = false',
  ))
  assert.deepEqual(unrelated.rows, [])
  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress', 'searching', 'offered', 'completed', 'canceled']) {
    await db.query('update public.trips set status = $1 where id = $2', [status, activeTrip])
    const result = await as(db, 'authenticated', rider, () => db.query(
      'select driver_id from public.driver_status where online = false order by driver_id',
    ))
    const active = ['accepted', 'arriving', 'arrived', 'in_progress'].includes(status)
    assert.deepEqual(result.rows, active ? [{ driver_id: assignedDriver }] : [], status)
  }

  await as(db, 'authenticated', driver, () => db.query('update public.driver_status set online = false where driver_id = $1', [driver]))
  const offline = await as(db, 'authenticated', driver, () => db.query("select id from public.trips where status = 'searching'"))
  assert.deepEqual(offline.rows, [])
  const anonymous = await as(db, 'anon', null, () => db.query('select id from public.trips'))
  assert.deepEqual(anonymous.rows, [])

  for (const [role, expected] of [['anon', false], ['authenticated', true], ['service_role', true]]) {
    const { rows } = await db.query(
      "select has_function_privilege($1, 'public.rider_has_active_trip_with_driver(uuid)', 'EXECUTE') as ok", [role],
    )
    assert.equal(rows[0].ok, expected, role)
  }
  const { rows: fn } = await db.query(`
    select prosecdef, provolatile, proconfig,
      exists (select 1 from aclexplode(proacl) where grantee = 0 and privilege_type = 'EXECUTE') as public_execute
    from pg_proc where oid = 'public.rider_has_active_trip_with_driver(uuid)'::regprocedure
  `)
  assert.deepEqual(fn, [{ prosecdef: true, provolatile: 's', proconfig: ['search_path=public'], public_execute: false }])
  const { rows: policy } = await db.query(`
    select polcmd, polroles = array['authenticated'::regrole::oid] as authenticated_only,
      obj_description(oid, 'pg_policy') as comment
    from pg_policy where polrelid = 'public.driver_status'::regclass and polname = 'driver_status_assigned_rider_read'
  `)
  assert.deepEqual(policy, [{
    polcmd: 'r', authenticated_only: true,
    comment: "Assigned rider can read this driver's presence during an active trip when trip_driver_locations is empty.",
  }])
})

test('recursion migration safely skips missing tables', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(migration)
  await db.exec('create table public.driver_status (driver_id uuid primary key)')
  await db.exec(migration)
  await db.exec('drop table public.driver_status; create table public.trips (id uuid primary key)')
  await db.exec(migration)
  const { rows } = await db.query("select to_regprocedure('public.rider_has_active_trip_with_driver(uuid)') as helper")
  assert.equal(rows[0].helper, null)
})
