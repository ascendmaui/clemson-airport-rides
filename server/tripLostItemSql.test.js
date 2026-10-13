import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261007220000_trip_lost_item_messaging.sql', import.meta.url),
  'utf8',
)

const rider = '00000000-0000-0000-0000-00000000000a'
const driver = '00000000-0000-0000-0000-000000000001'
const stranger = '00000000-0000-0000-0000-00000000000b'
const adminId = '00000000-0000-0000-0000-00000000000c'
const trip = '00000000-0000-0000-0000-000000000010'

async function asUser(db, userId, role, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role || ''])
  await db.exec('set role authenticated')
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function insertMessage(db, userId, body) {
  return asUser(db, userId, '', () => db.query(
    'insert into public.trip_messages (trip_id, sender_id, body) values ($1, $2, $3) returning sender_role',
    [trip, userId, body],
  ))
}

test('lost-item messaging is enforced for pre-ride, in-ride, post-ride, and the reopen window', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
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
      canceled_at timestamptz
    );
    create table public.trip_messages (
      id uuid primary key default gen_random_uuid(),
      trip_id uuid not null references public.trips (id) on delete cascade,
      sender_id uuid not null references public.profiles (id),
      body text not null,
      created_at timestamptz not null default now(),
      read_at timestamptz,
      constraint trip_messages_body_len check (char_length(btrim(body)) between 1 and 500)
    );
    create or replace function public.is_admin() returns boolean
    language sql stable
    as $$ select coalesce(current_setting('request.jwt.claim.role', true), '') in ('admin', 'ops') $$;
    insert into public.profiles values ('${rider}'), ('${driver}'), ('${stranger}'), ('${adminId}');
    insert into public.trips values ('${trip}', '${rider}', '${driver}', 'accepted', null, null);
    alter table public.trip_messages enable row level security;
    grant select, insert, update on public.trip_messages to authenticated;
    grant select on public.trips to authenticated;
    grant select on public.profiles to authenticated;
  `)
  await db.exec(migration)
  await db.exec(`
    drop policy if exists trip_messages_select_parties on public.trip_messages;
    create policy trip_messages_select_parties
      on public.trip_messages for select to authenticated
      using (public.can_access_trip_messages(trip_id));
    drop policy if exists trip_messages_insert_parties on public.trip_messages;
    create policy trip_messages_insert_parties
      on public.trip_messages for insert to authenticated
      with check (sender_id = auth.uid() and public.can_send_trip_message(trip_id));
  `)

  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress']) {
    await db.query('update public.trips set status = $2 where id = $1', [trip, status])
    const inserted = await insertMessage(db, rider, `hello ${status}`)
    assert.equal(inserted.rows[0].sender_role, 'rider', status)
  }

  await db.query(
    "update public.trips set status = 'completed', completed_at = now() - interval '1 hour' where id = $1",
    [trip],
  )
  await assert.rejects(() => insertMessage(db, driver, 'after the ride'), /open lost-item|active trip|row-level security|new row violates/i)

  await db.query(
    "update public.trips set status = 'canceled', canceled_at = now() - interval '1 hour', completed_at = null where id = $1",
    [trip],
  )
  await assert.rejects(() => insertMessage(db, rider, 'canceled'), /open lost-item|active trip|row-level security|new row violates/i)

  await db.query(
    "update public.trips set status = 'completed', completed_at = now() - interval '2 days', canceled_at = null where id = $1",
    [trip],
  )
  const report = await asUser(db, driver, '', () => db.query(
    `insert into public.trip_lost_item_reports (trip_id, reporter_id, reporter_role, description)
     values ($1, $2, 'rider', '  black backpack  ')
     returning reporter_role, description, status`,
    [trip, driver],
  ))
  assert.equal(report.rows[0].reporter_role, 'driver')
  assert.equal(report.rows[0].description, 'black backpack')
  assert.equal(report.rows[0].status, 'open')

  const during = await insertMessage(db, rider, 'I can pick it up')
  assert.equal(during.rows[0].sender_role, 'rider')

  await asUser(db, stranger, '', async () => {
    const hidden = await db.query('select count(*)::int as n from public.trip_messages')
    assert.equal(hidden.rows[0].n, 0)
  })

  const adminView = await asUser(db, adminId, 'admin', () => db.query(
    'select count(*)::int as n from public.trip_messages',
  ))
  assert.equal(adminView.rows[0].n > 0, true)

  await db.exec('alter table public.trip_lost_item_reports disable trigger trip_lost_item_reports_before_write')
  await db.query(
    "update public.trip_lost_item_reports set opened_at = now() - interval '8 days' where trip_id = $1",
    [trip],
  )
  await db.exec('alter table public.trip_lost_item_reports enable trigger trip_lost_item_reports_before_write')
  await assert.rejects(() => insertMessage(db, driver, 'too late'), /open lost-item|active trip|row-level security|new row violates/i)

  await db.exec('alter table public.trip_lost_item_reports disable trigger trip_lost_item_reports_before_write')
  await db.query(
    "update public.trip_lost_item_reports set opened_at = now() - interval '1 hour', status = 'open' where trip_id = $1",
    [trip],
  )
  await db.exec('alter table public.trip_lost_item_reports enable trigger trip_lost_item_reports_before_write')
  await asUser(db, rider, '', () => db.query(
    `update public.trip_lost_item_reports
     set status = 'resolved', resolved_by = $1
     where trip_id = $2`,
    [rider, trip],
  ))
  await assert.rejects(() => insertMessage(db, driver, 'after resolve'), /open lost-item|active trip|row-level security|new row violates/i)

  await db.query(
    "update public.trips set completed_at = now() - interval '8 days' where id = $1",
    [trip],
  )
  await assert.rejects(
    () => asUser(db, driver, '', () => db.query(
      `insert into public.trip_lost_item_reports (trip_id, reporter_id, reporter_role)
       values ($1, $2, 'driver')`,
      [trip, driver],
    )),
    /recently completed|row-level security|new row violates/i,
  )
})
