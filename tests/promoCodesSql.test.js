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
    create table public.promo_codes (id uuid primary key default gen_random_uuid(), code text unique, owner_id uuid, type text);
    insert into public.promo_codes (code, owner_id, type) values ('FRIEND88', '${R2}', 'rider_social');
  `)
  await db.exec(sql)
  return db
}

async function addCode(db, fields = {}) {
  const row = {
    code: 'TIGERS20', side: 'rider', discount_type: 'percent', percent_off_bps: 2000, amount_off_cents: 0,
    max_discount_cents: 1000, min_trip_cents: 1000, max_redemptions: 100, per_account_limit: 1,
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
  for (const table of ['promo_campaign_codes', 'promo_code_redemptions', 'promo_code_admin_events', 'promo_code_attempts']) {
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
  await assert.rejects(addCode(db, { code: 'friend88' }), /promo_code_taken|check/)
  await assert.rejects(addCode(db, { code: 'FRIEND88' }), /promo_code_taken/)
  const lower = await addCode(db, { code: 'FALLDROP' })
  assert.equal(lower.code, 'FALLDROP')
  await db.close()
})

test('reserve is idempotent per trip, enforces per-account and global limits', async () => {
  const db = await boot()
  await addCode(db, { max_redemptions: 2 })
  const t1 = await trip(db)
  const a = await one(db, `select promo_reserve_for_trip($1,'tigers20',$2,3000) r`, [R1, t1])
  assert.equal(a.r.ok, true)
  assert.equal(a.r.discount_cents, 600)
  const again = await one(db, `select promo_reserve_for_trip($1,'TIGERS20',$2,3000) r`, [R1, t1])
  assert.equal(again.r.duplicate, true)
  assert.equal(again.r.redemption_id, a.r.redemption_id)
  const t2 = await trip(db)
  const perAccount = await one(db, `select promo_reserve_for_trip($1,'TIGERS20',$2,3000) r`, [R1, t2])
  assert.equal(perAccount.r.reason, 'per_account_limit')
  const t3 = await trip(db, R2)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'TIGERS20',$2,3000) r`, [R2, t3])).r.ok, true)
  const R3 = '44444444-4444-4444-4444-444444444444'
  const t4 = await trip(db, R3)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'TIGERS20',$2,3000) r`, [R3, t4])).r.reason, 'max_redemptions')
  const count = await one(db, `select count(*)::int n from promo_code_redemptions where status = 'reserved'`)
  assert.equal(count.n, 2)
  await db.close()
})

test('expired, inactive, below-minimum, wrong-side and budget are refused', async () => {
  const db = await boot()
  await addCode(db, { code: 'OLDCODE', starts_at: new Date(Date.now() - 3 * 86400000).toISOString(), expires_at: new Date(Date.now() - 60000).toISOString() })
  await addCode(db, { code: 'OFFCODE', active: false })
  await addCode(db, { code: 'DRVBONUS', side: 'driver', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 2500, max_discount_cents: null })
  await addCode(db, { code: 'BUDGET', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 500, budget_cents: 700, max_discount_cents: null, per_account_limit: 5 })
  const r = async (code, fare = 3000, who = R1) => (await one(db, `select promo_reserve_for_trip($1,$2,$3,$4) r`, [who, code, await trip(db, who), fare])).r.reason
  assert.equal(await r('OLDCODE'), 'expired')
  assert.equal(await r('OFFCODE'), 'inactive')
  assert.equal(await r('TIGERS20'), 'not_found')
  await addCode(db)
  assert.equal(await r('TIGERS20', 900), 'below_minimum')
  assert.equal(await r('DRVBONUS'), 'wrong_side')
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'BUDGET',$2,3000) r`, [R1, await trip(db)])).r.ok, true)
  assert.equal(await r('BUDGET'), 'budget_exhausted')
  await db.close()
})

test('concurrent reserves on a single-use code: exactly one wins', async () => {
  const db = await boot()
  await addCode(db, { code: 'ONEUSE', max_redemptions: 1 })
  const riders = ['a', 'b', 'c', 'd', 'e'].map((x) => `${x.repeat(8)}-0000-0000-0000-000000000000`)
  const trips = await Promise.all(riders.map((id) => trip(db, id)))
  const results = await Promise.all(riders.map((id, i) => one(db, `select promo_reserve_for_trip($1,'ONEUSE',$2,3000) r`, [id, trips[i]])))
  assert.equal(results.filter((x) => x.r.ok).length, 1)
  await db.close()
})

test('signup claim is idempotent and is consumed by the next booking; cancel returns it to claimed', async () => {
  const db = await boot()
  await addCode(db, { code: 'WELCOME5', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 500, max_discount_cents: null, min_trip_cents: 0 })
  const c1 = await one(db, `select promo_claim_code($1,'welcome5','rider') r`, [R1])
  assert.equal(c1.r.ok, true)
  const c2 = await one(db, `select promo_claim_code($1,'WELCOME5','rider') r`, [R1])
  assert.equal(c2.r.duplicate, true)
  const t1 = await trip(db)
  const used = await one(db, `select promo_reserve_for_trip($1,null,$2,2000) r`, [R1, t1])
  assert.equal(used.r.ok, true)
  assert.equal(used.r.redemption_id, c1.r.redemption_id)
  assert.equal(used.r.discount_cents, 500)
  await db.query(`update trips set status = 'canceled' where id = $1`, [t1])
  const back = await one(db, `select status, trip_id from promo_code_redemptions where id = $1`, [c1.r.redemption_id])
  assert.equal(back.status, 'claimed')
  assert.equal(back.trip_id, null)
  const t2 = await trip(db)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,null,$2,2000) r`, [R1, t2])).r.ok, true)
  await db.query(`update trips set status = 'completed' where id = $1`, [t2])
  const done = await one(db, `select status from promo_code_redemptions where id = $1`, [c1.r.redemption_id])
  assert.equal(done.status, 'redeemed')
  const fin = await one(db, `select promo_finalize_for_trip($1, 450, 1800) r`, [t2])
  assert.equal(fin.r.discount_cents, 450)
  const fin2 = await one(db, `select promo_finalize_for_trip($1, 450, 1800) r`, [t2])
  assert.equal(fin2.r.ok, true)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,null,$2,2000) r`, [R1, await trip(db)])).r.reason, 'no_code')
  await db.close()
})

test('booking-time code is released on cancel and frees the slot', async () => {
  const db = await boot()
  await addCode(db, { code: 'ONEUSE', max_redemptions: 1 })
  const t1 = await trip(db)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'ONEUSE',$2,3000) r`, [R1, t1])).r.ok, true)
  await db.query(`update trips set status = 'cancelled_wait' where id = $1`, [t1])
  assert.equal((await one(db, `select status from promo_code_redemptions where trip_id = $1`, [t1])).status, 'released')
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'ONEUSE',$2,3000) r`, [R2, await trip(db, R2)])).r.ok, true)
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

test('one per device and one per card fingerprint across accounts', async () => {
  const db = await boot()
  await addCode(db, { code: 'FIRSTTEN', discount_type: 'flat', percent_off_bps: 0, amount_off_cents: 1000, max_discount_cents: null, min_trip_cents: 0 })
  const ok = await one(db, `select promo_reserve_for_trip($1,'FIRSTTEN',$2,3000,'dev-1','fp_A') r`, [R1, await trip(db)])
  assert.equal(ok.r.ok, true)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'FIRSTTEN',$2,3000,'dev-1','fp_B') r`, [R2, await trip(db, R2)])).r.reason, 'device_limit')
  assert.equal((await one(db, `select promo_reserve_for_trip($1,'FIRSTTEN',$2,3000,'dev-2','fp_A') r`, [R2, await trip(db, R2)])).r.reason, 'card_limit')
  assert.equal((await one(db, `select promo_claim_code($1,'FIRSTTEN','rider','dev-1') r`, [R2])).r.reason, 'device_limit')
  // A claimed signup code is refused at booking on a card already used by another account.
  assert.equal((await one(db, `select promo_claim_code($1,'FIRSTTEN','rider','dev-3') r`, [R2])).r.ok, true)
  assert.equal((await one(db, `select promo_reserve_for_trip($1,null,$2,3000,'dev-3','fp_A') r`, [R2, await trip(db, R2)])).r.reason, 'card_limit')
  assert.equal((await one(db, `select promo_reserve_for_trip($1,null,$2,3000,'dev-3','fp_C') r`, [R2, await trip(db, R2)])).r.ok, true)
  await db.close()
})
