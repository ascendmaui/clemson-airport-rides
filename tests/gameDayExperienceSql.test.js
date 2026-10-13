import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const file = '20261013100000_game_day_experience.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const driver = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const eventId = '33333333-3333-4333-8333-333333333333'

test('game-day experience migration is additive and uses a unique version', () => {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013100000').length, 1)
  assert.equal(file.startsWith('20261013100000'), true)
  assert.doesNotMatch(migration, /drop table/i)
  assert.doesNotMatch(migration, /delete from/i)
  assert.doesNotMatch(migration, /truncate/i)
  assert.match(migration, /create table if not exists public\.game_day_zones/i)
  assert.match(migration, /create table if not exists public\.game_day_pickup_queue/i)
  assert.match(migration, /create table if not exists public\.game_day_prep_items/i)
  assert.match(migration, /create table if not exists public\.game_day_prep_checks/i)
  assert.match(migration, /create table if not exists public\.game_day_zone_windows/i)
})

async function apply(db) {
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select '${driver}'::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.profiles (id uuid primary key);
    insert into public.profiles (id) values ('${driver}'), ('${other}');
    create table public.game_day_events (
      id uuid primary key,
      title text,
      active boolean,
      starts_at timestamptz,
      ends_at timestamptz
    );
    insert into public.game_day_events (id, title, active) values ('${eventId}', 'Home game', true);
    create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  `)
  await db.exec(migration)
  await db.exec(migration)
}

test('stadium guide, prep, and the pickup queue enforce row access', async () => {
  const db = new PGlite()
  try {
    await apply(db)
    const counts = await db.query(`
      select
        (select count(*)::int from public.game_day_zones) as zones,
        (select count(*)::int from public.game_day_zone_windows) as windows,
        (select count(*)::int from public.game_day_prep_items) as prep
    `)
    assert.deepEqual(counts.rows[0], { zones: 4, windows: 5, prep: 5 })

    assert.equal((await db.query(`select has_table_privilege('anon', 'public.game_day_zones', 'select') as ok`)).rows[0].ok, true)
    assert.equal((await db.query(`select has_table_privilege('anon', 'public.game_day_zones', 'insert') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('anon', 'public.game_day_prep_checks', 'select') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.game_day_prep_checks', 'insert') as ok`)).rows[0].ok, true)

    await db.exec('set role anon')
    assert.equal((await db.query('select count(*)::int as n from public.game_day_zones')).rows[0].n, 4)
    await assert.rejects(
      () => db.query(`insert into public.game_day_pickup_queue (event_id, status) values ('${eventId}', 'open')`),
      /permission denied/i,
    )
    await db.exec('reset role')

    await db.exec('set role authenticated')
    await db.query(`insert into public.game_day_prep_checks (driver_id, event_id, item_id) values ('${driver}', '${eventId}', 'charge')`)
    assert.equal((await db.query('select count(*)::int as n from public.game_day_prep_checks')).rows[0].n, 1)
    await assert.rejects(
      () => db.query(`insert into public.game_day_prep_checks (driver_id, event_id, item_id) values ('${other}', '${eventId}', 'zones')`),
      /row-level security/i,
    )
    await assert.rejects(
      () => db.query(`insert into public.game_day_zones (id, kind, name, instructions) values ('44444444-4444-4444-8444-444444444444', 'pickup', 'Extra', 'No')`),
      /row-level security/i,
    )
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})
