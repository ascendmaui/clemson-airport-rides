import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const privacy = readFileSync(
  new URL('../supabase/migrations/20261013200000_rider_driver_privacy.sql', import.meta.url),
  'utf8',
)
const migration = readFileSync(
  new URL('../supabase/migrations/20261018100000_driver_years_experience.sql', import.meta.url),
  'utf8',
)

const DRIVER = '11111111-1111-4111-8111-111111111111'
const RIDER = '22222222-2222-4222-8222-222222222222'
const NEWBIE = '44444444-4444-4444-8444-444444444444'

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
      id uuid primary key, full_name text, phone text, email text, avatar_url text, bio text,
      ride_style text, favorite_spots jsonb not null default '[]'::jsonb, music_taste text,
      rating_avg numeric, rating_count integer, standing text, student_verified_at timestamptz, role text
    );
    create table public.driver_applications (id uuid primary key default gen_random_uuid(), profile_id uuid, onboarding_status text);
    create table public.vehicles (id uuid primary key default gen_random_uuid(), driver_id uuid, color text, make text, model text, plate text, tier text);
    create table public.trips (id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid, status text);
  `)
  await db.exec(privacy)
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(`
    insert into public.profiles (id, full_name, phone, role, rating_avg, rating_count) values
      ('${DRIVER}', 'Ada Lovelace', '8645550199', 'driver', 4.9, 12),
      ('${RIDER}', 'Sam Okonkwo', '8645550142', 'rider', null, 0),
      ('${NEWBIE}', 'Ben Hur', '8645550101', 'driver', null, 0);
    update public.profiles set years_experience = 7 where id = '${DRIVER}';
    insert into public.driver_applications (profile_id, onboarding_status) values ('${DRIVER}', 'approved'), ('${NEWBIE}', 'approved');
    insert into public.vehicles (driver_id, color, make, model, plate, tier) values ('${DRIVER}', 'Blue', 'Honda', 'Civic', 'ADA1', 'standard');
    insert into public.trips (rider_id, driver_id, status) values ('${RIDER}', '${DRIVER}', 'accepted');
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

test('rider card and driver profile functions return years_experience and keep their grants', async () => {
  const db = await harness()
  try {
    const cards = await asUser(db, RIDER, 'select * from public.list_rider_driver_cards($1::uuid[]) order by first_name', [[DRIVER, NEWBIE]])
    const ada = cards.rows.find((row) => row.id === DRIVER)
    assert.equal(ada.years_experience, 7)
    assert.equal(ada.first_name, 'Ada')
    assert.equal(Number(ada.rating_avg), 4.9)
    assert.equal(ada.rating_count, 12)
    assert.equal(cards.rows.find((row) => row.id === NEWBIE).years_experience, null)
    assert.equal('phone' in ada, false)

    const legacy = await asUser(db, RIDER, 'select * from public.list_driver_cards($1::uuid[])', [[DRIVER]])
    assert.equal(legacy.rows[0].years_experience, 7)

    const profile = await asUser(db, RIDER, 'select * from public.rider_driver_profile($1::uuid)', [DRIVER])
    assert.equal(profile.rows[0].years_experience, 7)
    assert.equal(profile.rows[0].first_name, 'Ada')

    await assert.rejects(
      () => db.exec(`update public.profiles set years_experience = 120 where id = '${DRIVER}'`),
      /profiles_years_experience_range/,
    )

    const grants = await db.query(`
      select
        has_function_privilege('anon', 'public.list_rider_driver_cards(uuid[])', 'execute') as anon_cards,
        has_function_privilege('authenticated', 'public.list_rider_driver_cards(uuid[])', 'execute') as auth_cards,
        has_function_privilege('anon', 'public.list_driver_cards(uuid[])', 'execute') as anon_legacy,
        has_function_privilege('authenticated', 'public.list_driver_cards(uuid[])', 'execute') as auth_legacy,
        has_function_privilege('anon', 'public.rider_driver_profile(uuid)', 'execute') as anon_profile,
        has_function_privilege('authenticated', 'public.rider_driver_profile(uuid)', 'execute') as auth_profile,
        has_function_privilege('service_role', 'public.rider_driver_profile(uuid)', 'execute') as service_profile
    `)
    assert.deepEqual(grants.rows[0], {
      anon_cards: false,
      auth_cards: true,
      anon_legacy: false,
      auth_legacy: true,
      anon_profile: false,
      auth_profile: true,
      service_profile: true,
    })
  } finally {
    await db.close()
  }
})
