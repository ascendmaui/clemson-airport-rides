import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261016200000_ad_system.sql', import.meta.url), 'utf8')
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const PARTNER = 'bbbbbbbb-0000-4000-8000-000000000001'
const STRANGER = 'cccccccc-0000-4000-8000-000000000001'

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
  await db.exec(migration)
  await db.exec(migration) // idempotent
  await db.exec(`
    insert into public.ad_partners (id, profile_id, business_name, contact_name, email) values
      ('dddddddd-0000-4000-8000-000000000001', '${PARTNER}', 'TEST Mine', 'Pat', 'mine@example.test'),
      ('dddddddd-0000-4000-8000-000000000002', null, 'TEST Theirs', 'Sam', 'theirs@example.test');
    insert into public.ad_campaigns (id, partner_id, status, rides_purchased) values
      ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'active', 2),
      ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002', 'active', null);
  `)
  return db
}

async function as(db, role, uid, sql) {
  await db.exec(`set role ${role}; select set_config('test.uid', '${uid || ''}', false);`)
  try { return await db.query(sql) } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}

test('placeholder packages are seeded inactive and hidden from the public', async () => {
  const db = await setup()
  const all = await db.query('select id, active, placeholder from public.ad_packages order by sort')
  assert.deepEqual(all.rows.map((r) => r.id), ['placeholder-local', 'placeholder-featured', 'placeholder-game-day'])
  assert.ok(all.rows.every((r) => r.placeholder && !r.active))
  assert.equal((await as(db, 'anon', '', 'select * from public.ad_packages')).rows.length, 0)
  await db.exec(`insert into public.ad_packages (id, name, price_cents, active, placeholder) values ('real', 'Real', 1000, true, false)`)
  assert.deepEqual((await as(db, 'anon', '', 'select id from public.ad_packages')).rows.map((r) => r.id), ['real'])
})

test('partners read only their own campaigns; strangers and anon read nothing; admins read all', async () => {
  const db = await setup()
  assert.deepEqual((await as(db, 'authenticated', PARTNER, 'select business_name from public.ad_campaigns c join public.ad_partners p on p.id = c.partner_id')).rows.map((r) => r.business_name), ['TEST Mine'])
  assert.equal((await as(db, 'authenticated', STRANGER, 'select * from public.ad_campaigns')).rows.length, 0)
  assert.equal((await as(db, 'authenticated', ADMIN, 'select * from public.ad_campaigns')).rows.length, 2)
  await assert.rejects(as(db, 'anon', '', 'select * from public.ad_campaigns'))
})

test('only admins write; partners cannot activate their own campaign', async () => {
  const db = await setup()
  const upd = await as(db, 'authenticated', PARTNER, `update public.ad_campaigns set status = 'active', rides_purchased = 9999 where partner_id = 'dddddddd-0000-4000-8000-000000000001' returning id`)
  assert.equal(upd.rows.length, 0)
  await assert.rejects(as(db, 'authenticated', PARTNER, `insert into public.ad_partners (business_name, contact_name, email) values ('X Biz', 'X', 'x@example.test')`))
  await assert.rejects(as(db, 'anon', '', `insert into public.ad_impressions (campaign_id) values ('eeeeeeee-0000-4000-8000-000000000001')`))
  const ok = await as(db, 'authenticated', ADMIN, `update public.ad_campaigns set status = 'paused' where id = 'eeeeeeee-0000-4000-8000-000000000002' returning id`)
  assert.equal(ok.rows.length, 1)
})

test('ad_count_ride counts once per trip, ends the campaign at the purchased rides and is service-role only', async () => {
  const db = await setup()
  const C = 'eeeeeeee-0000-4000-8000-000000000001'
  const T1 = 'ffffffff-0000-4000-8000-000000000001'
  const T2 = 'ffffffff-0000-4000-8000-000000000002'
  const first = await db.query(`select * from public.ad_count_ride('${C}', '${T1}')`)
  assert.deepEqual(first.rows[0], { counted: true, rides_served: 1, status: 'active' })
  const dup = await db.query(`select * from public.ad_count_ride('${C}', '${T1}')`)
  assert.equal(dup.rows[0].counted, false)
  const last = await db.query(`select * from public.ad_count_ride('${C}', '${T2}')`)
  assert.deepEqual(last.rows[0], { counted: true, rides_served: 2, status: 'ended' })
  await assert.rejects(as(db, 'authenticated', ADMIN, `select * from public.ad_count_ride('${C}', '${T2}')`))
  await assert.rejects(as(db, 'anon', '', `select * from public.ad_count_ride('${C}', '${T2}')`))
})

test('migration keeps product locks', () => {
  const banned = new RegExp(['te' + 'sla', 'self' + '-driving', 'andr' + 'oid', 'play ' + 'store'].join('|'), 'i')
  assert.equal(banned.test(migration), false)
  assert.match(migration, /PLACEHOLDER/)
})
