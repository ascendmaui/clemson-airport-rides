import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261015160000_promo_campaign_codes.sql', import.meta.url), 'utf8')
const R1 = '11111111-1111-1111-1111-111111111111'
const R2 = '22222222-2222-2222-2222-222222222222'
const D1 = '33333333-3333-3333-3333-333333333333'

async function boot() {
  const db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create type public.trip_status as enum ('searching','accepted','in_progress','completed','canceled','canceled_midride','cancelled_wait');
    create table public.trips (id uuid primary key default gen_random_uuid(), rider_id uuid, status public.trip_status default 'searching', fare_cents int);
    create table public.profiles (id uuid primary key, email text, stripe_default_pm_id text, credit_balance_cents bigint not null default 0);
    create table public.promo_codes (id uuid primary key default gen_random_uuid(), code text unique, owner_id uuid, type text);
    insert into public.promo_codes (code, owner_id, type) values ('FRIEND88', '${R2}', 'rider_social');
  `)
  await db.exec(sql)
  return db
}

async function addCode(db, fields = {}) {
  const row = {
    code: 'TIGERS20', side: 'rider', discount_type: 'percent', percent_off_bps: 2000, amount_off_cents: 0,
    max_discount_cents: 1000, min_trip_cents: 1000,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), ...fields,
  }
  const cols = Object.keys(row)
  const { rows } = await db.query(
    `insert into promo_campaign_codes (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
    cols.map((c) => row[c]),
  )
  return rows[0]
}

async function trip(db, rider = R1, fare = 3000) {
  const { rows } = await db.query(`insert into trips (rider_id, fare_cents) values ($1, $2) returning id`, [rider, fare])
  return rows[0].id
}

const one = async (db, text, params) => (await db.query(text, params)).rows[0]

test('migration is additive and locked to service_role', () => {
  const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(body, /drop table|delete from|truncate|alter table public\.trips|alter table public\.promo_codes|alter table public\.promo_rules/i)
  for (const table of ['promo_campaign_codes', 'promo_code_redemptions', 'promo_code_admin_events', 'promo_code_attempts', 'promo_auto_settings', 'promo_email_outbox']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`))
  }
  assert.doesNotMatch(sql, /grant execute on function public\.promo_\w+\([^)]*\) to [^;]*authenticated/)
  assert.doesNotMatch(sql, /to anon/)
})

test('discount math: percent with cap, flat, minimum trip, never above fare', async () => {
  const db = await boot()
  const f = async (...a) => (await one(db, 'select promo_compute_discount($1,$2,$3,$4,$5,$6) d', a)).d
  assert.equal(await f('percent', 2000, 0, 1000, 0, 3000), 600)
  assert.equal(await f('percent', 2000, 0, 500, 0, 3000), 500)
  assert.equal(await f('flat', 0, 500, null, 0, 300), 300)
  assert.equal(await f('flat', 0, 500, null, 1000, 900), 0)
  assert.equal(await f('percent', 2000, 0, null, 0, 0), 0)
  await db.close()
})

test('guardrails in the table: driver codes flat only, caps, lifetime, collisions with rider_social', async () => {
  const db = await boot()
  await assert.rejects(addCode(db, { code: 'DRIVE50', side: 'driver' }), /driver_flat_only/)
  await assert.rejects(addCode(db, { code: 'HUGE', percent_off_bps: 9000 }), /check/)
  await assert.rejects(addCode(db, { code: 'BIGFLAT', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 9000 }), /check/)
  await assert.rejects(addCode(db, { code: 'LONGLIVE', expires_at: new Date(Date.now() + 400 * 86400000).toISOString() }), /max_lifetime/)
  await assert.rejects(addCode(db, { code: 'MULTI', max_redemptions: 2 }), /max_redemptions|check/)
  await assert.rejects(addCode(db, { code: 'MULTI2', per_account_limit: 2 }), /per_account_limit|check/)
  await assert.rejects(addCode(db, { code: 'NOOWNER', source: 'auto_card' }), /auto_owner/)
  await assert.rejects(addCode(db, { code: 'friend88' }), /promo_code_taken|check/)
  await assert.rejects(addCode(db, { code: 'FRIEND88' }), /promo_code_taken/)
  const lower = await addCode(db, { code: 'FALLDROP' })
  assert.equal(lower.code, 'FALLDROP')
  await db.close()
})

const R3 = '44444444-4444-4444-4444-444444444444'
const reserve = async (db, who, code, fare = 3000, device = null, card = null, tripId = null) =>
  (await one(db, `select promo_reserve_for_trip($1,$2,$3,$4,$5,$6) r`, [who, code, tripId || await trip(db, who), fare, device, card])).r

test('one-time use: a code redeems exactly once, ever', async () => {
  const db = await boot()
  const code = await addCode(db)
  const t1 = await trip(db)
  const a = await reserve(db, R1, 'tigers20', 3000, null, null, t1)
  assert.equal(a.ok, true)
  assert.equal(a.discount_cents, 600)
  const again = await reserve(db, R1, 'TIGERS20', 3000, null, null, t1)
  assert.equal(again.duplicate, true, 'idempotent per trip')
  assert.equal(again.redemption_id, a.redemption_id)
  assert.equal((await reserve(db, R1, 'TIGERS20')).reason, 'per_account_limit')
  assert.equal((await reserve(db, R2, 'TIGERS20')).reason, 'max_redemptions')
  // The database refuses a second live redemption even if a caller skips the RPC.
  await assert.rejects(db.query(
    `insert into promo_code_redemptions (code_id, code, side, profile_id, status, idempotency_key) values ($1,'TIGERS20','rider',$2,'claimed','x')`,
    [code.id, R2]), /single_use|unique/)
  await db.query(`update trips set status = 'completed' where id = $1`, [t1])
  assert.equal((await one(db, `select status from promo_code_redemptions where id = $1`, [a.redemption_id])).status, 'redeemed')
  await assert.rejects(db.query(`update promo_code_redemptions set status = 'released' where id = $1`, [a.redemption_id]), /promo_redemption_final/)
  await db.query(`update trips set status = 'canceled' where id = $1`, [t1])
  assert.equal((await one(db, `select status from promo_code_redemptions where id = $1`, [a.redemption_id])).status, 'redeemed')
  assert.equal((await reserve(db, R3, 'TIGERS20')).reason, 'max_redemptions')
  await db.close()
})

test('expired, inactive, below-minimum, wrong-side and budget are refused', async () => {
  const db = await boot()
  await addCode(db, { code: 'OLDCODE', starts_at: new Date(Date.now() - 3 * 86400000).toISOString(), expires_at: new Date(Date.now() - 60000).toISOString() })
  await addCode(db, { code: 'OFFCODE', active: false })
  await addCode(db, { code: 'DRVBONUS', side: 'driver', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 2500, max_discount_cents: null })
  await addCode(db, { code: 'BUDGET', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 500, budget_cents: 400, max_discount_cents: null })
  assert.equal((await reserve(db, R1, 'OLDCODE')).reason, 'expired')
  assert.equal((await reserve(db, R1, 'OFFCODE')).reason, 'inactive')
  assert.equal((await reserve(db, R1, 'TIGERS20')).reason, 'not_found')
  await addCode(db)
  assert.equal((await reserve(db, R1, 'TIGERS20', 900)).reason, 'below_minimum')
  assert.equal((await reserve(db, R1, 'DRVBONUS')).reason, 'wrong_side')
  assert.equal((await reserve(db, R1, 'BUDGET')).reason, 'budget_exhausted')
  await db.close()
})

test('concurrent reserves on a single-use code: exactly one wins', async () => {
  const db = await boot()
  await addCode(db, { code: 'ONEUSE' })
  const riders = ['a', 'b', 'c', 'd', 'e'].map((x) => `${x.repeat(8)}-0000-0000-0000-000000000000`)
  const trips = await Promise.all(riders.map((id) => trip(db, id)))
  const results = await Promise.all(riders.map((id, i) => one(db, `select promo_reserve_for_trip($1,'ONEUSE',$2,3000) r`, [id, trips[i]])))
  assert.equal(results.filter((x) => x.r.ok).length, 1)
  assert.equal((await one(db, `select count(*)::int n from promo_code_redemptions`)).n, 1)
  await db.close()
})

test('signup claim is idempotent and is consumed by the next booking; cancel returns it to claimed', async () => {
  const db = await boot()
  await addCode(db, { code: 'WELCOME5', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 500, max_discount_cents: null, min_trip_cents: 0 })
  const c1 = await one(db, `select promo_claim_code($1,'welcome5','rider') r`, [R1])
  assert.equal(c1.r.ok, true)
  assert.equal((await one(db, `select promo_claim_code($1,'WELCOME5','rider') r`, [R1])).r.duplicate, true)
  assert.equal((await one(db, `select promo_claim_code($1,'WELCOME5','rider') r`, [R2])).r.reason, 'max_redemptions')
  const t1 = await trip(db)
  const used = await reserve(db, R1, null, 2000, null, null, t1)
  assert.equal(used.ok, true)
  assert.equal(used.redemption_id, c1.r.redemption_id)
  assert.equal(used.discount_cents, 500)
  await db.query(`update trips set status = 'canceled' where id = $1`, [t1])
  const back = await one(db, `select status, trip_id from promo_code_redemptions where id = $1`, [c1.r.redemption_id])
  assert.equal(back.status, 'claimed')
  assert.equal(back.trip_id, null)
  const t2 = await trip(db)
  assert.equal((await reserve(db, R1, null, 2000, null, null, t2)).ok, true)
  await db.query(`update trips set status = 'completed' where id = $1`, [t2])
  assert.equal((await one(db, `select status from promo_code_redemptions where id = $1`, [c1.r.redemption_id])).status, 'redeemed')
  const fin = await one(db, `select promo_finalize_for_trip($1, 450, 1800) r`, [t2])
  assert.equal(fin.r.discount_cents, 450)
  assert.equal((await one(db, `select promo_finalize_for_trip($1, 450, 1800) r`, [t2])).r.ok, true)
  assert.equal((await reserve(db, R1, null, 2000)).reason, 'no_code')
  await db.close()
})

test('a code typed at booking goes back to that rider on cancel; a failed booking frees it', async () => {
  const db = await boot()
  await addCode(db, { code: 'ONEUSE' })
  const t1 = await trip(db)
  assert.equal((await reserve(db, R1, 'ONEUSE', 3000, null, null, t1)).ok, true)
  await db.query(`update trips set status = 'cancelled_wait' where id = $1`, [t1])
  assert.equal((await one(db, `select status from promo_code_redemptions where code = 'ONEUSE'`)).status, 'claimed')
  assert.equal((await reserve(db, R2, 'ONEUSE')).reason, 'max_redemptions', 'not consumed, and still not transferable')
  assert.equal((await reserve(db, R1, null)).ok, true, 'used on the next ride')

  await addCode(db, { code: 'TWOUSE' })
  const t2 = await trip(db, R2)
  assert.equal((await reserve(db, R2, 'TWOUSE', 3000, null, null, t2)).ok, true)
  await one(db, `select promo_release_for_trip($1, 'trip_insert_failed') r`, [t2])
  assert.equal((await reserve(db, R3, 'TWOUSE')).ok, true)
  await db.close()
})

test('driver claim records a flat incentive; failed lookups are rate limited', async () => {
  const db = await boot()
  await addCode(db, { code: 'DRVBONUS', side: 'driver', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 2500, max_discount_cents: null })
  const d = await one(db, `select promo_claim_code($1,'DRVBONUS','driver') r`, [D1])
  assert.equal(d.r.ok, true)
  assert.equal(d.r.discount_cents, 2500)
  assert.equal((await one(db, `select promo_claim_code($1,'DRVBONUS','rider') r`, [R1])).r.reason, 'wrong_side')
  for (let i = 0; i < 10; i++) await db.query(`select promo_check_code($1,$2,'rider',null)`, [R2, `NOPE${i}`])
  assert.equal((await one(db, `select promo_check_code($1,'DRVBONUS','driver',null) r`, [R2])).r.reason, 'too_many_attempts')
  await db.close()
})

test('a batch of single-use codes: one per account, device and card', async () => {
  const db = await boot()
  const batch = '99999999-9999-4999-8999-999999999999'
  const flat = { discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 1000, max_discount_cents: null, min_trip_cents: 0, batch_id: batch }
  for (const code of ['BATCHA1', 'BATCHB2', 'BATCHC3']) await addCode(db, { ...flat, code })
  assert.equal((await reserve(db, R1, 'BATCHA1', 3000, 'dev-1', 'fp_A')).ok, true)
  assert.equal((await reserve(db, R1, 'BATCHB2', 3000, 'dev-9', 'fp_Z')).reason, 'per_account_limit')
  assert.equal((await reserve(db, R2, 'BATCHB2', 3000, 'dev-1', 'fp_B')).reason, 'device_limit')
  assert.equal((await reserve(db, R2, 'BATCHB2', 3000, 'dev-2', 'fp_A')).reason, 'card_limit')
  assert.equal((await reserve(db, R2, 'BATCHB2', 3000, 'dev-2', 'fp_B')).ok, true)
  await db.close()
})

const profile = (db, id, fields = {}) => db.query(
  `insert into profiles (id, email, stripe_default_pm_id, credit_balance_cents) values ($1, $2, $3, $4)`,
  [id, fields.email || `${id.slice(0, 4)}@example.com`, fields.pm || null, fields.credits || 0],
)
const autoCodes = async (db, id) => (await db.query(
  `select * from promo_campaign_codes where owner_profile_id = $1 order by source`, [id])).rows

test('auto codes: one per trigger per account, ever; 50% off, uncapped, 90 days, claimed', async () => {
  const db = await boot()
  await profile(db, R1)
  let codes = await autoCodes(db, R1)
  assert.deepEqual(codes.map((c) => c.source), ['auto_signup'])
  const signup = codes[0]
  assert.equal(signup.percent_off_bps, 5000)
  assert.equal(signup.max_discount_cents, null)
  assert.equal(signup.max_redemptions, 1)
  const days = (new Date(signup.expires_at) - new Date(signup.starts_at)) / 86400000
  assert.ok(Math.abs(days - 90) < 0.01, `expires in 90 days (${days})`)
  assert.match(signup.code, /^HI[A-HJ-NP-Z2-9]{8}$/)

  await db.query(`update profiles set stripe_default_pm_id = 'pm_1' where id = $1`, [R1])
  await db.query(`update profiles set stripe_default_pm_id = null where id = $1`, [R1])
  await db.query(`update profiles set stripe_default_pm_id = 'pm_2' where id = $1`, [R1])
  await db.query(`update profiles set credit_balance_cents = 4999 where id = $1`, [R1])
  await db.query(`update profiles set credit_balance_cents = 5000 where id = $1`, [R1])
  await db.query(`update profiles set credit_balance_cents = 1000 where id = $1`, [R1])
  await db.query(`update profiles set credit_balance_cents = 9000 where id = $1`, [R1])
  codes = await autoCodes(db, R1)
  assert.deepEqual(codes.map((c) => c.source), ['auto_card', 'auto_credit50', 'auto_signup'])
  assert.equal((await one(db, `select count(*)::int n from promo_email_outbox where profile_id = $1`, [R1])).n, 3)
  assert.equal((await one(db, `select count(*)::int n from promo_code_redemptions where profile_id = $1 and status = 'claimed'`, [R1])).n, 3)
  const dup = await one(db, `select promo_issue_auto_code($1, 'auto_card') r`, [R1])
  assert.equal(dup.r.duplicate, true)
  await db.close()
})

test('auto codes are bound to the owner and uncapped by default (the margin risk)', async () => {
  const db = await boot()
  await profile(db, R1)
  await profile(db, R2)
  const [mine] = await autoCodes(db, R1)
  assert.equal((await reserve(db, R2, mine.code)).reason, 'not_found', 'not transferable, no enumeration')
  // A ~$152 CLT fare: 50% with no cap is $76 off, all platform-funded.
  const clt = await reserve(db, R1, null, 15200, 'dev-1', 'fp_A')
  assert.equal(clt.ok, true)
  assert.equal(clt.code, mine.code)
  assert.equal(clt.discount_cents, 7600)
  // A second account cannot use its own auto signup code on the same card.
  assert.equal((await reserve(db, R2, null, 3000, 'dev-2', 'fp_A')).reason, 'card_limit')
  assert.equal((await reserve(db, R2, null, 3000, 'dev-1', 'fp_B')).reason, 'device_limit')
  assert.equal((await reserve(db, R2, null, 3000, 'dev-2', 'fp_B')).ok, true)
  // The optional cap and expiry are settings.
  await db.query(`update promo_auto_settings set max_discount_cents = 2500, expires_days = 30`)
  await profile(db, R3)
  const [capped] = await autoCodes(db, R3)
  assert.equal(capped.max_discount_cents, 2500)
  assert.equal((await reserve(db, R3, null, 15200)).discount_cents, 2500)
  await db.close()
})

test('auto issue can be switched off and never blocks sign-up', async () => {
  const db = await boot()
  await db.query(`update promo_auto_settings set issue_enabled = false`)
  await profile(db, R1)
  assert.equal((await autoCodes(db, R1)).length, 0)
  await db.query(`update promo_auto_settings set issue_enabled = true`)
  await db.exec(`create or replace function public.promo_issue_auto_code(p_profile uuid, p_trigger text) returns jsonb language plpgsql as $$ begin raise exception 'boom'; end; $$;`)
  await profile(db, R2)
  assert.equal((await one(db, `select count(*)::int n from profiles where id = $1`, [R2])).n, 1)
  await db.close()
})

test('email outbox: one row per code, leased once', async () => {
  const db = await boot()
  await profile(db, R1)
  const first = (await db.query(`select * from promo_claim_email_batch(10)`)).rows
  assert.equal(first.length, 1)
  assert.equal(first[0].status, 'sending')
  assert.equal(first[0].attempts, 1)
  assert.equal((await db.query(`select * from promo_claim_email_batch(10)`)).rows.length, 0, 'leased rows are skipped')
  const [code] = await autoCodes(db, R1)
  await assert.rejects(db.query(`insert into promo_email_outbox (code_id, profile_id, kind) values ($1, $2, 'auto_signup')`, [code.id, R1]), /unique|duplicate/)
  await db.close()
})
