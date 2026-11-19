import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { RIDE_BUNDLES } from '../src/content/adPackages.js'

const read = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')

test('approval migration activates the 4 ride bundles and confirms Option C affiliate multipliers idempotently', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to anon, authenticated, service_role;
    create type public.trip_status as enum ('searching','accepted','in_progress','completed','canceled');
    create table public.profiles (id uuid primary key, email text, phone text, full_name text, is_admin boolean default false);
    create table public.vehicles (id uuid primary key);
    create table public.trips (id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid, status public.trip_status, fare_cents integer, metadata jsonb default '{}');
    create function public.is_admin() returns boolean language sql stable security definer as $$
      select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;
  `)
  await db.exec(read('20261012200000_affiliate_program.sql'))
  await db.exec(read('20261012230000_affiliate_connect.sql'))
  await db.exec(read('20261012231000_affiliate_option_c.sql'))
  await db.exec(read('20261016200000_ad_system.sql'))
  await db.exec(read('20261017100000_ad_tracking_selfserve.sql'))

  const approveSql = read('20261119131000_approve_monetization_rates.sql')
  await db.exec(approveSql)
  await db.exec(approveSql) // idempotent

  const bundles = (await db.query(
    `select id, price_cents, rides_included, active, placeholder from public.ad_packages where kind = 'bundle' order by sort`,
  )).rows
  assert.deepEqual(
    bundles.map((r) => [r.id, r.price_cents, r.rides_included, r.active, r.placeholder]),
    RIDE_BUNDLES.map((b) => [b.id, b.priceCents, b.rides, true, false]),
  )

  const addon = (await db.query(`select active, placeholder from public.ad_packages where id = 'game-day-weekend'`)).rows[0]
  assert.equal(addon.active, false)
  assert.equal(addon.placeholder, true)

  const rates = (await db.query(`select value from public.affiliate_config where key = 'rates'`)).rows[0].value
  assert.equal(rates.plan, 'option_c')
  assert.equal(rates.multipliers_pending_confirmation, false)
  assert.equal(rates.rider_first_ride_cents, 400)
  assert.equal(rates.rider_min_fare_cents, 1500)
  assert.equal(rates.driver_first_trip_cents, 2000)
  assert.deepEqual(rates.partner_type_bps, {
    student: 10000,
    campus_org: 12500,
    local_business: 12500,
    influencer: 15000,
  })
})
