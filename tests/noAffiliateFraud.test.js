// Affiliate program: no self-referral, no duplicate device/phone/payment payouts,
// no e2e test trips, no real money (Stripe test keys only). Lives under the
// tests/no*.test.js glob so it runs without editing the package.json test list.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  affiliateLink, attributionDecision, bountyCents, generateAffiliateCode, isStripeTestKey,
  normalizeAffiliateCode, planPayoutBatch, summarizeLedger, validateAffiliateApplication,
} from '../shared/affiliates/rules.js'
import { AFFILIATE_RATES_PLACEHOLDER } from '../shared/affiliates/config.js'

const sql = readFileSync(new URL('../supabase/migrations/20261012200000_affiliate_program.sql', import.meta.url), 'utf8')
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create type public.trip_status as enum ('searching','accepted','in_progress','completed','canceled');
    create table public.profiles (id uuid primary key, email text, phone text);
    create table public.trips (id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid,
      status public.trip_status, metadata jsonb default '{}');
  `)
  for (let i = 1; i <= 12; i++) {
    await db.query('insert into auth.users (id) values ($1)', [U(i)])
    await db.query('insert into profiles (id, email, phone) values ($1, $2, $3)', [U(i), i === 9 ? 'e2e+rider@clemsonrides.com' : `u${i}@x.com`, null])
  }
  await db.exec(sql)
  await db.exec(`insert into affiliates (id, user_id, code, partner_type, display_name, contact_email, phone, status)
    values ('${U(100)}', '${U(1)}', 'TIGER1', 'student', 'Tiger', 't@x.com', '864-555-0100', 'active')`)
  return db
}
const attribute = (db, user, role, device = null) => db.query(
  'insert into affiliate_attributions (affiliate_id, referred_user_id, role, device_hash) values ($1, $2, $3, $4)', [U(100), user, role, device])
async function completeTrip(db, rider, driver, metadata = {}) {
  const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, driver_id, status, metadata) values ($1, $2, 'in_progress', $3) returning id`, [rider, driver, metadata])
  await db.query(`update trips set status = 'completed' where id = $1`, [id])
  return id
}
const att = async (db, user, role = 'rider') => (await db.query('select status, reject_reason from affiliate_attributions where referred_user_id = $1 and role = $2', [user, role])).rows[0]
const ledger = async (db) => (await db.query('select kind, amount_cents, status from affiliate_ledger order by created_at')).rows

test('rider first completed ride and driver first trip qualify with placeholder rates', async (t) => {
  const db = await setup(); t.after(() => db.close())
  await attribute(db, U(2), 'rider', 'devA')
  await attribute(db, U(3), 'driver', 'devB')
  await completeTrip(db, U(2), U(3))
  assert.equal((await att(db, U(2))).status, 'qualified')
  assert.equal((await att(db, U(3), 'driver')).status, 'qualified')
  assert.deepEqual((await ledger(db)).map((r) => [r.kind, r.amount_cents, r.status]).sort(), [
    ['referral_driver', 2500, 'pending'], ['referral_rider', 500, 'pending']])
  // second ride does not pay again
  await completeTrip(db, U(2), U(3))
  assert.equal((await ledger(db)).length, 2)
})

test('self-referral: affiliate is the driver on the referred rider trip, or shares a phone', async (t) => {
  const db = await setup(); t.after(() => db.close())
  await attribute(db, U(2), 'rider')
  await completeTrip(db, U(2), U(1))
  assert.deepEqual(await att(db, U(2)), { status: 'rejected', reject_reason: 'self_referral' })
  await db.query(`update profiles set phone = '(864) 555-0100' where id = $1`, [U(4)])
  await attribute(db, U(4), 'rider')
  await completeTrip(db, U(4), U(5))
  assert.equal((await att(db, U(4))).reject_reason, 'self_referral')
  assert.equal((await ledger(db)).length, 0)
})

test('dedupe by device, phone and payment fingerprint', async (t) => {
  const db = await setup(); t.after(() => db.close())
  await attribute(db, U(2), 'rider', 'devX')
  await attribute(db, U(4), 'rider', 'devX')
  await completeTrip(db, U(2), U(3))
  await completeTrip(db, U(4), U(3))
  assert.equal((await att(db, U(4))).reject_reason, 'duplicate_device_phone_or_payment')
  await db.query(`update profiles set phone = '8645550199' where id in ($1, $2)`, [U(5), U(6)])
  await attribute(db, U(5), 'rider'); await attribute(db, U(6), 'rider')
  await completeTrip(db, U(5), U(3)); await completeTrip(db, U(6), U(3))
  assert.equal((await att(db, U(6))).status, 'rejected')
  await db.query(`insert into affiliate_attributions (affiliate_id, referred_user_id, role, payment_fingerprint) values ($1,$2,'rider','fp1'),($1,$3,'rider','fp1')`, [U(100), U(7), U(8)])
  await completeTrip(db, U(7), U(3)); await completeTrip(db, U(8), U(3))
  assert.equal((await att(db, U(8))).status, 'rejected')
  assert.equal((await ledger(db)).length, 3)
})

test('e2e test trips and accounts never qualify; trigger never blocks completion', async (t) => {
  const db = await setup(); t.after(() => db.close())
  await attribute(db, U(2), 'rider')
  await completeTrip(db, U(2), U(3), { e2e_test: true })
  assert.equal((await att(db, U(2))).status, 'signed_up')
  await attribute(db, U(9), 'rider')
  await completeTrip(db, U(9), U(3))
  assert.equal((await att(db, U(9))).reject_reason, 'e2e_test')
  await db.exec('drop table affiliate_config cascade')
  await attribute(db, U(10), 'rider')
  const id = await completeTrip(db, U(10), U(3))
  assert.equal((await db.query('select status from trips where id = $1', [id])).rows[0].status, 'completed')
})

test('not first trip and paused affiliates earn nothing', async (t) => {
  const db = await setup(); t.after(() => db.close())
  await completeTrip(db, U(2), U(3))
  await attribute(db, U(2), 'rider')
  await completeTrip(db, U(2), U(3))
  assert.equal((await att(db, U(2))).reject_reason, 'not_first_trip')
  await db.exec(`update affiliates set status = 'paused'`)
  await attribute(db, U(4), 'rider')
  await completeTrip(db, U(4), U(3))
  assert.equal((await att(db, U(4))).status, 'qualified')
  assert.equal((await ledger(db)).length, 0)
})

test('clients cannot write affiliate tables', async (t) => {
  const db = await setup(); t.after(() => db.close())
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U(2)}', false)`)
  await assert.rejects(db.query(`insert into affiliate_ledger (affiliate_id, kind, amount_cents) values ('${U(100)}', 'adjustment', 100)`))
  await assert.rejects(db.query('select * from affiliate_attributions'))
})

test('pure rules', () => {
  assert.equal(normalizeAffiliateCode(' tiger-1 '), 'TIGER1')
  assert.equal(normalizeAffiliateCode('ab'), '')
  assert.equal(affiliateLink('tiger1'), 'https://clemsonrides.com/r/TIGER1')
  assert.match(generateAffiliateCode('Tiger Tutors', () => 0.5), /^TIGERT[A-Z2-9]{4}$/)
  const affiliate = { id: 'a', user_id: 'u1', status: 'active', phone: '8645550100', contact_email: 'a@x.com' }
  assert.equal(attributionDecision({ affiliate, user: { id: 'u1' } }).code, 'self_referral')
  assert.equal(attributionDecision({ affiliate, user: { id: 'u2', email: 'A@x.com' } }).code, 'self_referral')
  assert.equal(attributionDecision({ affiliate, user: { id: 'u2' }, profile: { phone: '+1 864 555 0100' } }).code, 'self_referral')
  assert.equal(attributionDecision({ affiliate, user: { id: 'u2', email: 'e2e+r@clemsonrides.com' } }).code, 'e2e_test')
  assert.equal(attributionDecision({ affiliate, user: { id: 'u2' }, existing: { id: 1 } }).code, 'already_attributed')
  assert.equal(attributionDecision({ affiliate: { ...affiliate, status: 'pending' }, user: { id: 'u2' } }).code, 'inactive_code')
  assert.equal(attributionDecision({ affiliate, user: { id: 'u2' } }).ok, true)
  assert.equal(bountyCents('driver', 'student'), AFFILIATE_RATES_PLACEHOLDER.driver_first_trip_cents)
  assert.equal(bountyCents('rider', 'influencer', { ...AFFILIATE_RATES_PLACEHOLDER, partner_type_bps: { influencer: 5000 } }), Math.round(AFFILIATE_RATES_PLACEHOLDER.rider_first_ride_cents / 2))
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.plan, 'option_c')
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.rider_first_ride_cents, 400)
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.rider_min_fare_cents, 1500)
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.driver_first_trip_cents, 2000)
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.partner_type_bps.campus_org, 12500)
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.partner_type_bps.local_business, 12500)
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.partner_type_bps.influencer, 15000)
  assert.equal(AFFILIATE_RATES_PLACEHOLDER.multipliers_pending_confirmation, true)
  assert.match(AFFILIATE_RATES_PLACEHOLDER.multipliers_note, /John to confirm/)
  assert.equal(bountyCents('rider', 'campus_org'), 500)
  assert.equal(bountyCents('driver', 'influencer'), 3000)
  assert.equal(validateAffiliateApplication({ partner_type: 'campus_org', display_name: 'X Club', contact_email: 'x@y.co', agree: true }).errors.org_name, 'Organization name required')
  assert.equal(validateAffiliateApplication({ partner_type: 'student', display_name: 'Sam', contact_email: 's@clemson.edu', agree: true }).ok, true)
  const now = Date.parse('2026-10-30T00:00:00Z')
  const plan = planPayoutBatch([
    { id: 1, affiliate_id: 'a', amount_cents: 500, status: 'pending', created_at: '2026-10-01T00:00:00Z' },
    { id: 2, affiliate_id: 'a', amount_cents: 500, status: 'pending', created_at: '2026-10-02T00:00:00Z' },
    { id: 3, affiliate_id: 'a', amount_cents: 500, status: 'pending', created_at: '2026-10-29T00:00:00Z' },
    { id: 4, affiliate_id: 'b', amount_cents: 500, status: 'pending', created_at: '2026-10-01T00:00:00Z' },
  ], { now })
  assert.deepEqual(plan.include, [{ affiliate_id: 'a', total_cents: 1000, entry_ids: [1, 2] }])
  assert.deepEqual(plan.rollover, [{ affiliate_id: 'b', total_cents: 500 }])
  assert.deepEqual(summarizeLedger([{ status: 'paid', amount_cents: 5 }, { status: 'pending', amount_cents: 2 }]), { pending_cents: 2, approved_cents: 0, paid_cents: 5, void_cents: 0 })
  assert.equal(isStripeTestKey('sk_test_abc'), true)
  assert.equal(isStripeTestKey('sk_live_abc'), false)
  assert.equal(isStripeTestKey(undefined), false)
})

test('affiliate API: routes, auth and admin gating', async () => {
  const { createAffiliatesHandler, AFFILIATE_ACTIONS } = await import('../server/endpoints/affiliates.js')
  const res = () => ({ statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b ?? '' } })
  const h = createAffiliatesHandler({ admin: () => ({}), userFromAuth: async () => null, loadStaffAccess: async () => ({ admin: false }) })
  let r = res(); await h({ method: 'GET', url: '/api/affiliates?action=nope', headers: {} }, r); assert.equal(r.statusCode, 400)
  r = res(); await h({ method: 'GET', url: '/api/affiliates?action=me', headers: {} }, r); assert.equal(r.statusCode, 401)
  r = res(); await h({ method: 'GET', url: '/api/affiliates?action=claim', headers: {} }, r); assert.equal(r.statusCode, 405)
  const h2 = createAffiliatesHandler({ admin: () => ({}), userFromAuth: async () => ({ id: 'u' }), loadStaffAccess: async () => ({ admin: false }) })
  r = res(); await h2({ method: 'POST', url: '/api/affiliates?action=admin-batch-pay', headers: {}, body: {} }, r); assert.equal(r.statusCode, 403)
  assert.ok(AFFILIATE_ACTIONS.includes('admin-batch-approve'))
})
