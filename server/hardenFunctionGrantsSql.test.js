import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const lostItemMigration = readFileSync(
  new URL('../supabase/migrations/20261007220000_trip_lost_item_messaging.sql', import.meta.url),
  'utf8',
)
const hardening = readFileSync(
  new URL('../supabase/migrations/20261007233000_harden_function_grants.sql', import.meta.url),
  'utf8',
)

const rider = '00000000-0000-0000-0000-00000000000a'
const driver = '00000000-0000-0000-0000-000000000001'
const trip = '00000000-0000-0000-0000-000000000010'

async function as(db, role, userId, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
  await db.query("select set_config('request.jwt.claim.role', '', false)")
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function canExecute(db, role, signature) {
  const { rows } = await db.query('select has_function_privilege($1, $2::regprocedure, \'EXECUTE\') as ok', [role, signature])
  return rows[0].ok
}

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    -- Supabase default privileges: new public functions are executable by every API role.
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

    create type public.trip_status as enum (
      'requested', 'searching', 'offered', 'accepted', 'arriving', 'arrived',
      'in_progress', 'completed', 'canceled', 'cancelled_wait', 'scheduled'
    );
    create table public.profiles (id uuid primary key);
    create table public.trips (
      id uuid primary key,
      rider_id uuid references public.profiles (id),
      driver_id uuid references public.profiles (id),
      status public.trip_status,
      completed_at timestamptz,
      canceled_at timestamptz,
      released_reason text
    );
    create table public.trip_messages (
      id uuid primary key default gen_random_uuid(),
      trip_id uuid not null references public.trips (id) on delete cascade,
      sender_id uuid not null references public.profiles (id),
      body text not null,
      created_at timestamptz not null default now(),
      read_at timestamptz
    );
    create or replace function public.is_admin() returns boolean
    language sql stable
    as $$ select false $$;
    insert into public.profiles values ('${rider}'), ('${driver}');
    insert into public.trips (id, rider_id, driver_id, status) values ('${trip}', '${rider}', '${driver}', 'accepted');
    alter table public.trip_messages enable row level security;
    grant select, insert, update on public.trip_messages to authenticated;
    grant select on public.trips, public.profiles to authenticated;

    -- Shapes of the prod functions this migration touches (bodies simplified).
    create or replace function public.driver_approval_ready(target uuid) returns boolean
    language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.profiles where id = target) $$;
    create or replace function public.review_driver_application(target uuid) returns boolean
    language plpgsql security definer set search_path = public
    as $$ begin return public.driver_approval_ready(target); end $$;

    create or replace function public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text) returns void
    language plpgsql security definer set search_path = public
    as $$ begin update public.trips set released_reason = p_reason where id = p_trip; end $$;
    create table public.driver_offer_passes (trip_id uuid, driver_id uuid);
    grant insert on public.driver_offer_passes to authenticated;
    create or replace function public.matching_offer_passed() returns trigger
    language plpgsql security definer set search_path = public
    as $$ begin perform public.release_matching_offer(new.trip_id, new.driver_id, 'driver_decline'); return new; end $$;
    create trigger matching_offer_passed after insert on public.driver_offer_passes
      for each row execute function public.matching_offer_passed();

    create table public.driver_applications (profile_id uuid primary key, background_check_status text);
    grant select, insert on public.driver_applications to authenticated;
    create or replace function public.enforce_background_attestation() returns trigger
    language plpgsql
    as $$ begin new.background_check_status := 'pending'; return new; end $$;
    create trigger driver_applications_background_attestation before insert or update on public.driver_applications
      for each row execute function public.enforce_background_attestation();
  `)
  await db.exec(lostItemMigration)
  await db.exec(`
    create policy trip_messages_select_parties
      on public.trip_messages for select to authenticated
      using (public.can_access_trip_messages(trip_id));
    create policy trip_messages_insert_parties
      on public.trip_messages for insert to authenticated
      with check (sender_id = auth.uid() and public.can_send_trip_message(trip_id));
  `)
  return db
}

test('harden_function_grants: revokes API access only where nothing depends on it', async (t) => {
  const db = await setup()
  t.after(() => db.close())

  // Precondition: defaults left anon/authenticated able to call these.
  assert.equal(await canExecute(db, 'anon', 'public.release_matching_offer(uuid,uuid,text)'), true)
  assert.equal(await canExecute(db, 'anon', 'public.driver_approval_ready(uuid)'), true)

  await db.exec(hardening)
  // Re-running is a no-op (safe if applied twice).
  await db.exec(hardening)

  for (const sig of [
    'public.driver_approval_ready(uuid)',
    'public.release_matching_offer(uuid,uuid,text)',
    'public.trip_messages_before_write()',
    'public.trip_lost_item_reports_before_write()',
  ]) {
    assert.equal(await canExecute(db, 'anon', sig), false, `anon ${sig}`)
    assert.equal(await canExecute(db, 'authenticated', sig), false, `authenticated ${sig}`)
    assert.equal(await canExecute(db, 'service_role', sig), true, `service_role ${sig}`)
  }

  // Policy helpers stay callable by authenticated (RLS runs as the caller), not by anon.
  for (const sig of [
    'public.can_access_trip_messages(uuid)',
    'public.can_send_trip_message(uuid)',
    'public.can_open_lost_item_report(uuid)',
    'public.lost_item_thread_window()',
  ]) {
    assert.equal(await canExecute(db, 'authenticated', sig), true, `authenticated ${sig}`)
    assert.equal(await canExecute(db, 'anon', sig), false, `anon ${sig}`)
  }

  const { rows: cfg } = await db.query(`
    select proname, proconfig from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('enforce_background_attestation', 'lost_item_thread_window')
    order by proname`)
  assert.deepEqual(cfg.map((r) => [r.proname, r.proconfig]), [
    ['enforce_background_attestation', ['search_path=public, pg_temp']],
    ['lost_item_thread_window', ['search_path=public, pg_temp']],
  ])
})

test('harden_function_grants: triggers, policies and definer callers still work for signed-in users', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  await db.exec(hardening)

  // trip_messages: before-write trigger + insert/select policies, as the rider.
  const sent = await as(db, 'authenticated', rider, () => db.query(
    'insert into public.trip_messages (trip_id, sender_id, body) values ($1, $2, $3) returning sender_role',
    [trip, rider, '  on my way  '],
  ))
  assert.equal(sent.rows[0].sender_role, 'rider')
  const seen = await as(db, 'authenticated', driver, () => db.query('select body from public.trip_messages'))
  assert.deepEqual(seen.rows.map((r) => r.body), ['on my way'])

  // trip_lost_item_reports: before-write trigger + can_open_lost_item_report policy.
  await db.query("update public.trips set status = 'completed', completed_at = now() - interval '1 hour' where id = $1", [trip])
  const report = await as(db, 'authenticated', driver, () => db.query(
    `insert into public.trip_lost_item_reports (trip_id, reporter_id, reporter_role, description)
     values ($1, $2, 'rider', 'umbrella') returning reporter_role, status`,
    [trip, driver],
  ))
  assert.equal(report.rows[0].reporter_role, 'driver')
  assert.equal(report.rows[0].status, 'open')

  // release_matching_offer still runs when a SECURITY DEFINER trigger calls it for an authenticated user.
  await as(db, 'authenticated', driver, () => db.query(
    'insert into public.driver_offer_passes (trip_id, driver_id) values ($1, $2)',
    [trip, driver],
  ))
  const released = await db.query('select released_reason from public.trips where id = $1', [trip])
  assert.equal(released.rows[0].released_reason, 'driver_decline')

  // driver_approval_ready still works through its SECURITY DEFINER caller.
  await db.exec('grant execute on function public.review_driver_application(uuid) to authenticated')
  const ready = await as(db, 'authenticated', driver, () => db.query('select public.review_driver_application($1) as ok', [driver]))
  assert.equal(ready.rows[0].ok, true)

  // enforce_background_attestation (invoker trigger) still fires after pinning search_path.
  const app = await as(db, 'authenticated', driver, () => db.query(
    "insert into public.driver_applications values ($1, 'authorized') returning background_check_status",
    [driver],
  ))
  assert.equal(app.rows[0].background_check_status, 'pending')

  // Direct API-style calls are now refused.
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(
      () => as(db, role, driver, () => db.query("select public.release_matching_offer($1, $2, 'x')", [trip, driver])),
      /permission denied/i,
    )
    await assert.rejects(
      () => as(db, role, driver, () => db.query('select public.driver_approval_ready($1)', [driver])),
      /permission denied/i,
    )
  }
})
