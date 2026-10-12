import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261012111402_rental_partner_portal.sql', import.meta.url), 'utf8')

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const P2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const DRV = 'cccccccc-0000-4000-8000-000000000001'
const DRV_NOCHECK = 'cccccccc-0000-4000-8000-000000000002'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles (id uuid primary key, full_name text, phone text, email text, rating_avg numeric, rating_count int, is_admin boolean default false);
    create table public.driver_applications (id uuid primary key default gen_random_uuid(), profile_id uuid, onboarding_status text, background_check_status text, background_admin_reviewed_at timestamptz);
    create function public.is_admin() returns boolean language sql stable security definer as $$
      select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;
    insert into public.profiles values
      ('${ADMIN}','Admin',null,'a@x.co',null,0,true),
      ('${P1}','P One','8640000001','p1@x.co',null,0,false),
      ('${P2}','P Two','8640000002','p2@x.co',null,0,false),
      ('${DRV}','Dee Driver','8640000003','d@x.co',4.9,12,false),
      ('${DRV_NOCHECK}','No Check','8640000004','n@x.co',null,0,false);
    insert into public.driver_applications (profile_id, onboarding_status, background_check_status) values
      ('${DRV}','approved','authorized'), ('${DRV_NOCHECK}','approved','pending');
  `)
  await db.exec(migration)
  await db.exec(migration) // idempotent
  return db
}

async function as(db, uid, fn) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}

const future = '2030-01-01'
function listingSql(partnerExpr, { year = 2021, condition = 'good', luxury = false, title = 'clean' } = {}) {
  return `insert into public.rental_listings (partner_id, make, model, year, body_style, seats, vin, title_status, mileage, photos, condition, condition_photos, inspection_kind, inspection_attested, registration_expires, insurance_expires, weekly_price_cents, pickup_location, luxury_exception, luxury_note, luxury_photos)
    values (${partnerExpr}, 'Toyota', 'Camry', ${year}, 'sedan', 5, '1HGCM82633A004352', '${title}', 40000, '{a.jpg}', '${condition}',
      '{"front":"f","back":"b","left":"l","right":"r","interior":"i"}', 'attestation', true, '${future}', '${future}', 25000, 'Clemson', ${luxury},
      ${luxury ? "'Classic Lincoln, garage kept'" : 'null'}, ${luxury ? "'{lux.jpg}'" : "'{}'"}) returning id, review_status`
}

async function partner(db, uid, name) {
  return as(db, uid, () => db.query(`insert into public.rental_partners (profile_id, business_name, contact_name, phone, email, city, service_area, terms_version, status)
    values ('${uid}', '${name}', 'C', '8640000000', 'x@x.co', 'Clemson', 'Upstate', 'v1', 'approved') returning id, status`))
}

test('partners start pending, cannot self-approve, and only admins approve', async () => {
  const db = await setup()
  const r = await partner(db, P1, 'One Rentals')
  assert.equal(r.rows[0].status, 'pending')
  await as(db, P1, () => db.query(`update public.rental_partners set status='approved' where profile_id='${P1}'`))
  assert.equal((await db.query(`select status from public.rental_partners where profile_id='${P1}'`)).rows[0].status, 'pending')
  await assert.rejects(() => as(db, P1, () => db.query(listingSql(`public.rental_partner_id_for('${P1}')`))), /row-level security/)
  await as(db, ADMIN, () => db.query(`update public.rental_partners set status='approved' where profile_id='${P1}'`))
  assert.equal((await db.query(`select status from public.rental_partners where profile_id='${P1}'`)).rows[0].status, 'approved')
  await assert.rejects(() => as(db, P2, () => db.query(`insert into public.rental_partners (profile_id, business_name, contact_name, phone, email, city, service_area, terms_version) values ('${P1}','x','x','x','x','x','x','v1')`)), /row-level security|duplicate/)
})

test('partners see only their own listings and requests; drivers see only approved listings; admin sees all', async () => {
  const db = await setup()
  await partner(db, P1, 'One'); await partner(db, P2, 'Two')
  await as(db, ADMIN, () => db.query(`update public.rental_partners set status='approved'`))
  const l1 = (await as(db, P1, () => db.query(listingSql(`public.rental_partner_id_for('${P1}')`)))).rows[0]
  assert.equal(l1.review_status, 'approved')
  const lux = (await as(db, P1, () => db.query(listingSql(`public.rental_partner_id_for('${P1}')`, { year: 2015, luxury: true })))).rows[0]
  assert.equal(lux.review_status, 'pending_admin_review')
  await as(db, P2, () => db.query(listingSql(`public.rental_partner_id_for('${P2}')`, { year: 2022 })))

  assert.equal((await as(db, P1, () => db.query('select id from public.rental_listings'))).rows.length, 2)
  assert.equal((await as(db, P2, () => db.query('select id from public.rental_listings'))).rows.length, 1)
  // P2 cannot list under P1
  await assert.rejects(() => as(db, P2, () => db.query(listingSql(`public.rental_partner_id_for('${P1}')`))), /row-level security/)
  // P2 cannot edit P1's listing
  const upd = await as(db, P2, () => db.query(`update public.rental_listings set weekly_price_cents=1 where id='${l1.id}' returning id`))
  assert.equal(upd.rows.length, 0)

  const driverRows = (await as(db, DRV, () => db.query('select id, review_status from public.rental_listings'))).rows
  assert.equal(driverRows.length, 2)
  assert.ok(driverRows.every((r) => r.review_status === 'approved'))
  assert.equal((await as(db, DRV_NOCHECK, () => db.query('select id from public.rental_listings'))).rows.length, 0)
  assert.equal((await as(db, ADMIN, () => db.query('select id from public.rental_listings'))).rows.length, 3)

  // paused listings disappear for drivers
  await as(db, P1, () => db.query(`update public.rental_listings set status='paused' where id='${l1.id}'`))
  assert.equal((await as(db, DRV, () => db.query('select id from public.rental_listings'))).rows.length, 1)
  assert.equal((await db.query(`select review_status from public.rental_listings where id='${l1.id}'`)).rows[0].review_status, 'approved')
  await as(db, P1, () => db.query(`update public.rental_listings set status='active' where id='${l1.id}'`))

  // requests
  await assert.rejects(() => as(db, DRV_NOCHECK, () => db.query(`insert into public.rental_requests (listing_id, partner_id, driver_id) values ('${l1.id}', public.rental_partner_id_for('${P1}'), '${DRV_NOCHECK}')`)), /row-level security/)
  await assert.rejects(() => as(db, DRV, () => db.query(`insert into public.rental_requests (listing_id, partner_id, driver_id) values ('${lux.id}', public.rental_partner_id_for('${P1}'), '${DRV}')`)), /row-level security/)
  const req = (await as(db, DRV, () => db.query(`insert into public.rental_requests (listing_id, partner_id, driver_id) values ('${l1.id}', public.rental_partner_id_for('${P1}'), '${DRV}') returning id`))).rows[0]
  assert.equal((await as(db, P1, () => db.query('select id from public.rental_requests'))).rows.length, 1)
  assert.equal((await as(db, P2, () => db.query('select id from public.rental_requests'))).rows.length, 0)
  await assert.rejects(() => as(db, DRV, () => db.query(`update public.rental_requests set status='active' where id='${req.id}'`)), /permission denied/)

  // contact hidden until accepted
  let card = (await as(db, P1, () => db.query(`select * from public.rental_request_driver_card('${req.id}')`))).rows[0]
  assert.equal(card.full_name, 'Dee Driver'); assert.equal(card.phone, null); assert.equal(card.email, null)
  assert.match(card.check_status, /passed/)
  await assert.rejects(() => as(db, P2, () => db.query(`select * from public.rental_request_driver_card('${req.id}')`)), /Not allowed/)
  await assert.rejects(() => as(db, DRV, () => db.query(`select public.rental_request_transition('${req.id}', 'accepted')`)), /Cannot move/)
  await assert.rejects(() => as(db, P2, () => db.query(`select public.rental_request_transition('${req.id}', 'accepted')`)), /Not allowed/)
  await as(db, P1, () => db.query(`select public.rental_request_transition('${req.id}', 'accepted')`))
  card = (await as(db, P1, () => db.query(`select * from public.rental_request_driver_card('${req.id}')`))).rows[0]
  assert.equal(card.phone, '8640000003')
  await as(db, P1, () => db.query(`select public.rental_request_transition('${req.id}', 'active', '2026-11-01')`))
  await as(db, DRV, () => db.query(`select public.rental_request_transition('${req.id}', 'ended', null, '2026-11-20')`))
  const done = (await db.query(`select status, start_date::text s, end_date::text e from public.rental_requests where id='${req.id}'`)).rows[0]
  assert.deepEqual(done, { status: 'ended', s: '2026-11-01', e: '2026-11-20' })
  await assert.rejects(() => as(db, P1, () => db.query(`select public.rental_request_transition('${req.id}', 'active')`)), /Cannot move/)

  // anon has nothing
  await db.exec('set role anon')
  await assert.rejects(() => db.query('select * from public.rental_listings'), /permission denied/)
  await db.exec('reset role')
})

test('DB enforces vehicle standards: 2019 floor, luxury exception, poor condition, salvage', async () => {
  const db = await setup()
  await partner(db, P1, 'One')
  await as(db, ADMIN, () => db.query(`update public.rental_partners set status='approved'`))
  const pid = `public.rental_partner_id_for('${P1}')`
  assert.equal((await as(db, P1, () => db.query(listingSql(pid, { year: 2019 })))).rows[0].review_status, 'approved')
  await assert.rejects(() => as(db, P1, () => db.query(listingSql(pid, { year: 2018 }))), /Luxury exception/)
  const lux = (await as(db, P1, () => db.query(listingSql(pid, { year: 2018, luxury: true })))).rows[0]
  assert.equal(lux.review_status, 'pending_admin_review')
  assert.equal((await as(db, P1, () => db.query(listingSql(pid, { year: 2024, condition: 'poor' })))).rows[0].review_status, 'rejected')
  await assert.rejects(() => as(db, P1, () => db.query(listingSql(pid, { title: 'salvage' }))), /Salvage/)
  // partner cannot self-approve a luxury listing
  await as(db, P1, () => db.query(`update public.rental_listings set review_status='approved' where id='${lux.id}'`))
  assert.equal((await db.query(`select review_status from public.rental_listings where id='${lux.id}'`)).rows[0].review_status, 'pending_admin_review')
  await as(db, ADMIN, () => db.query(`update public.rental_listings set review_status='approved' where id='${lux.id}'`))
  assert.equal((await db.query(`select review_status from public.rental_listings where id='${lux.id}'`)).rows[0].review_status, 'approved')
})
