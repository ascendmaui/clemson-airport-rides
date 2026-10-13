import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261013103000_rider_driver_privacy.sql', import.meta.url),
  'utf8',
)

const DRIVER = '11111111-1111-4111-8111-111111111111'
const RIDER = '22222222-2222-4222-8222-222222222222'
const STRANGER = '33333333-3333-4333-8333-333333333333'
const INITIAL = '44444444-4444-4444-8444-444444444444'
const PHONE = '8645550199'
const RIDER_PHONE = '8645550142'

async function harness() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key,
      full_name text,
      phone text,
      email text,
      avatar_url text,
      bio text,
      ride_style text,
      favorite_spots jsonb not null default '[]'::jsonb,
      music_taste text,
      rating_avg numeric,
      rating_count integer,
      standing text,
      student_verified_at timestamptz,
      role text
    );
    create table public.driver_applications (
      id uuid primary key default gen_random_uuid(),
      profile_id uuid,
      onboarding_status text
    );
    create table public.vehicles (
      id uuid primary key default gen_random_uuid(),
      driver_id uuid,
      color text,
      make text,
      model text,
      plate text,
      tier text
    );
    create table public.trips (
      id uuid primary key default gen_random_uuid(),
      rider_id uuid,
      driver_id uuid,
      status text
    );
  `)
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(`
    insert into public.profiles (id, full_name, phone, email, role, bio)
    values
      ('${DRIVER}', 'Ada Lovelace', '${PHONE}', 'ada@clemson.edu', 'driver', 'Campus loop'),
      ('${RIDER}', 'Sam Okonkwo', '${RIDER_PHONE}', 'sam@clemson.edu', 'rider', 'Library'),
      ('${INITIAL}', 'A. Rivera', '8645550101', 'a@clemson.edu', 'driver', 'Initial only');
    insert into public.driver_applications (profile_id, onboarding_status)
    values ('${DRIVER}', 'approved'), ('${INITIAL}', 'approved');
    insert into public.vehicles (driver_id, color, make, model, plate, tier)
    values ('${DRIVER}', 'Blue', 'Honda', 'Civic', 'ADA1', 'standard');
    insert into public.trips (rider_id, driver_id, status)
    values ('${RIDER}', '${DRIVER}', 'accepted');
  `)
  return db
}

async function asUser(db, userId, sql, params = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
  await db.exec('set role authenticated')
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
  }
}

test('rider driver cards and profiles return a first name and never a phone or surname', async () => {
  const db = await harness()
  try {
    const columns = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'rider_driver_cards'
      order by ordinal_position
    `)
    const names = columns.rows.map((row) => row.column_name)
    assert.ok(names.includes('first_name'))
    for (const banned of ['phone', 'full_name', 'email', 'last_name']) {
      assert.equal(names.includes(banned), false, banned)
    }

    const cards = await db.query(
      `select * from public.list_rider_driver_cards($1::uuid[])`,
      [[DRIVER, INITIAL]],
    )
    const ada = cards.rows.find((row) => row.id === DRIVER)
    const initial = cards.rows.find((row) => row.id === INITIAL)
    assert.equal(ada.first_name, 'Ada')
    assert.equal(ada.make, 'Honda')
    assert.equal(initial.first_name, null)
    assert.equal(JSON.stringify(cards.rows).includes(PHONE), false)
    assert.equal(JSON.stringify(cards.rows).includes('Lovelace'), false)
    assert.equal(JSON.stringify(cards.rows).includes('Rivera'), false)
    assert.equal('phone' in ada, false)

    const view = await db.query(`select * from public.rider_driver_cards where id = $1`, [DRIVER])
    assert.equal(view.rows[0].first_name, 'Ada')
    assert.equal(JSON.stringify(view.rows).includes(PHONE), false)
    assert.equal('phone' in view.rows[0], false)

    const legacy = await db.query(`select full_name from public.list_driver_cards($1::uuid[])`, [[DRIVER, INITIAL]])
    assert.deepEqual(
      legacy.rows.map((row) => row.full_name).sort(),
      ['Ada', null].sort(),
    )

    const asRider = await asUser(
      db,
      RIDER,
      `select * from public.rider_driver_profile($1::uuid)`,
      [DRIVER],
    )
    assert.equal(asRider.rows.length, 1)
    assert.equal(asRider.rows[0].first_name, 'Ada')
    assert.equal('phone' in asRider.rows[0], false)
    assert.equal(JSON.stringify(asRider.rows).includes(PHONE), false)
    assert.equal(JSON.stringify(asRider.rows).includes('Lovelace'), false)

    const asStranger = await asUser(
      db,
      STRANGER,
      `select * from public.rider_driver_profile($1::uuid)`,
      [DRIVER],
    )
    assert.equal(asStranger.rows.length, 0)
    const asDriverCaller = await asUser(
      db,
      DRIVER,
      `select * from public.rider_driver_profile($1::uuid)`,
      [DRIVER],
    )
    assert.equal(asDriverCaller.rows.length, 0)

    const riderSeesDriver = await asUser(
      db,
      RIDER,
      `select full_name, phone from public.counterpart_profile($1::uuid)`,
      [DRIVER],
    )
    assert.equal(riderSeesDriver.rows[0].full_name, 'Ada')
    assert.equal(riderSeesDriver.rows[0].phone, null)
    assert.equal(JSON.stringify(riderSeesDriver.rows).includes(PHONE), false)

    const driverSeesRider = await asUser(
      db,
      DRIVER,
      `select full_name, phone from public.counterpart_profile($1::uuid)`,
      [RIDER],
    )
    assert.equal(driverSeesRider.rows[0].full_name, 'Sam Okonkwo')
    assert.equal(driverSeesRider.rows[0].phone, RIDER_PHONE)

    const listSig = 'public.list_rider_driver_cards(uuid[])'
    const profileSig = 'public.rider_driver_profile(uuid)'
    const helperSig = 'public.rider_driver_first_name(text)'
    const grants = await db.query(`
      select
        has_function_privilege('anon', '${listSig}', 'execute') as anon_cards,
        has_function_privilege('authenticated', '${listSig}', 'execute') as auth_cards,
        has_function_privilege('anon', '${profileSig}', 'execute') as anon_profile,
        has_function_privilege('authenticated', '${profileSig}', 'execute') as auth_profile,
        has_function_privilege('service_role', '${profileSig}', 'execute') as service_profile,
        has_function_privilege('anon', '${helperSig}', 'execute') as anon_helper,
        has_table_privilege('anon', 'public.rider_driver_cards', 'select') as anon_view
    `)
    assert.equal(grants.rows[0].anon_cards, true)
    assert.equal(grants.rows[0].auth_cards, true)
    assert.equal(grants.rows[0].anon_profile, false)
    assert.equal(grants.rows[0].auth_profile, true)
    assert.equal(grants.rows[0].service_profile, true)
    assert.equal(grants.rows[0].anon_helper, false)
    assert.equal(grants.rows[0].anon_view, true)

    await db.exec('set role anon')
    await assert.rejects(
      () => db.query(`select * from public.rider_driver_profile($1::uuid)`, [DRIVER]),
      /permission denied/i,
    )
  } finally {
    await db.exec('reset role').catch(() => {})
    await db.close()
  }
})
