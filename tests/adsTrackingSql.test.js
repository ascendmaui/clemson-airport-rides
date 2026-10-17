import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { RIDE_BUNDLES } from '../src/content/adPackages.js'

const read = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const BASE = read('20261016200000_ad_system.sql')
const TRACKING = read('20261017100000_ad_tracking_selfserve.sql')
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const PARTNER = 'bbbbbbbb-0000-4000-8000-000000000001'
const STRANGER = 'cccccccc-0000-4000-8000-000000000001'
const MINE = 'eeeeeeee-0000-4000-8000-000000000001'
const THEIRS = 'eeeeeeee-0000-4000-8000-000000000002'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, is_admin boolean default false);
    create table public.vehicles (id uuid primary key);
    create function public.is_admin() returns boolean language sql stable security definer as $$
      select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;
    insert into public.profiles values ('${ADMIN}', true), ('${PARTNER}', false), ('${STRANGER}', false);
  `)
  await db.exec(BASE)
  await db.exec(TRACKING)
  await db.exec(TRACKING) // idempotent
  await db.exec(`
    insert into public.ad_partners (id, profile_id, business_name, contact_name, email) values
      ('dddddddd-0000-4000-8000-000000000001', '${PARTNER}', 'TEST Mine', 'Pat', 'mine@example.test'),
      ('dddddddd-0000-4000-8000-000000000002', null, 'TEST Theirs', 'Sam', 'theirs@example.test');
    insert into public.ad_campaigns (id, partner_id, status, rides_purchased) values
      ('${MINE}', 'dddddddd-0000-4000-8000-000000000001', 'active', 2),
      ('${THEIRS}', 'dddddddd-0000-4000-8000-000000000002', 'active', null);
    insert into public.ad_qr_tokens (token, campaign_id, partner_id, destination_url) values
      ('tok_mine_0001', '${MINE}', 'dddddddd-0000-4000-8000-000000000001', 'https://a.example'),
      ('tok_them_0001', '${THEIRS}', 'dddddddd-0000-4000-8000-000000000002', 'https://b.example');
    insert into public.ad_qr_scans (token, campaign_id, trip_id) values
      ('tok_mine_0001', '${MINE}', gen_random_uuid()), ('tok_them_0001', '${THEIRS}', gen_random_uuid());
    insert into public.ad_ride_counts (campaign_id, trip_id) values ('${MINE}', gen_random_uuid()), ('${THEIRS}', gen_random_uuid());
    insert into public.ad_campaign_boosts (campaign_id, partner_id, rides_added, per_ride_cents, price_cents) values
      ('${MINE}', 'dddddddd-0000-4000-8000-000000000001', 2, 12, 24), ('${THEIRS}', 'dddddddd-0000-4000-8000-000000000002', 5, 10, 50);
  `)
  return db
}

async function as(db, role, uid, sql) {
  await db.exec(`set role ${role}; select set_config('test.uid', '${uid || ''}', false);`)
  try { return await db.query(sql) } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}

test('draft ride bundles match the config, stay placeholder and hidden from the public', async () => {
  const db = await setup()
  const rows = (await db.query(`select id, kind, price_cents, rides_included, active, placeholder from public.ad_packages where kind in ('bundle','addon') order by sort`)).rows
  assert.deepEqual(rows.filter((r) => r.kind === 'bundle').map((r) => [r.id, r.price_cents, r.rides_included]), RIDE_BUNDLES.map((b) => [b.id, b.priceCents, b.rides]))
  assert.ok(rows.every((r) => r.placeholder && !r.active))
  assert.ok(rows.some((r) => r.id === 'game-day-weekend' && r.kind === 'addon'))
  assert.equal((await as(db, 'anon', '', `select * from public.ad_packages where kind = 'bundle'`)).rows.length, 0)
})

test('partners read only their own QR scans, ride counts and boosts; strangers nothing; admin all; anon blocked', async () => {
  const db = await setup()
  for (const t of ['ad_qr_scans', 'ad_ride_counts', 'ad_campaign_boosts']) {
    assert.deepEqual((await as(db, 'authenticated', PARTNER, `select campaign_id from public.${t}`)).rows.map((r) => r.campaign_id), [MINE], t)
    assert.equal((await as(db, 'authenticated', STRANGER, `select * from public.${t}`)).rows.length, 0, t)
    assert.equal((await as(db, 'authenticated', ADMIN, `select * from public.${t}`)).rows.length, 2, t)
    await assert.rejects(as(db, 'anon', '', `select * from public.${t}`), undefined, t)
  }
  assert.equal((await as(db, 'authenticated', PARTNER, 'select * from public.ad_qr_tokens')).rows.length, 0, 'destinations stay admin/server only')
  await assert.rejects(as(db, 'authenticated', PARTNER, `insert into public.ad_qr_scans (token, campaign_id) values ('tok_mine_0001', '${MINE}')`))
  await assert.rejects(as(db, 'authenticated', PARTNER, `update public.ad_campaign_boosts set status = 'applied'`).then((r) => { if (!r.affectedRows) throw new Error('no rows') }))
})

test('founding-partner applications: anon inserts pending only and reads nothing; admin reviews', async () => {
  const db = await setup()
  const cols = `(business_name, category, address, contact_name, email, promote)`
  const vals = `('TEST Tavern', 'Restaurant or bar', '1 College Ave, Clemson', 'Pat', 'pat@example.test', 'Game-day specials')`
  await as(db, 'anon', '', `insert into public.ad_partner_applications ${cols} values ${vals}`)
  await assert.rejects(as(db, 'anon', '', `insert into public.ad_partner_applications (business_name, address, contact_name, email, promote, status) values ('TEST X', '1 College Ave', 'Pat', 'p@example.test', 'Deals', 'approved')`))
  await assert.rejects(as(db, 'anon', '', 'select * from public.ad_partner_applications'))
  assert.equal((await as(db, 'authenticated', STRANGER, 'select * from public.ad_partner_applications')).rows.length, 0)
  const all = await as(db, 'authenticated', ADMIN, 'select status from public.ad_partner_applications')
  assert.deepEqual(all.rows.map((r) => r.status), ['pending'])
  await as(db, 'authenticated', ADMIN, `update public.ad_partner_applications set status = 'approved'`)
  assert.equal((await db.query('select status from public.ad_partner_applications')).rows[0].status, 'approved')
})

test('new partner and campaign columns default safely (auto-approve off, targeting all rides)', async () => {
  const db = await setup()
  const p = (await db.query(`select founding_approved, auto_approve_creatives from public.ad_partners limit 1`)).rows[0]
  assert.deepEqual(p, { founding_approved: false, auto_approve_creatives: false })
  const c = (await db.query(`select targeting, game_day_boost from public.ad_campaigns where id = '${MINE}'`)).rows[0]
  assert.deepEqual(c, { targeting: { radius_mi: 0, routes: ['all'] }, game_day_boost: false })
  await assert.rejects(db.query(`insert into public.ad_qr_tokens (token, campaign_id, destination_url) values ('bad token!', '${MINE}', 'https://x.example')`))
})
