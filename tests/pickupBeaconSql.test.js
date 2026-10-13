import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { PICKUP_CODE_ALPHABET } from '../shared/pickupBeacon.js'

const file = '20261013260000_OPS_APPLY_trip_pickup_codes.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')

const RIDER = '22222222-2222-4222-8222-222222222222'
const DRIVER = '11111111-1111-4111-8111-111111111111'
const OTHER = '33333333-3333-4333-8333-333333333333'
const TRIP = '44444444-4444-4444-8444-444444444444'
const OPEN = '55555555-5555-4555-8555-555555555555'

async function harness() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.trips (
      id uuid primary key,
      rider_id uuid,
      driver_id uuid,
      status text
    );
    insert into public.trips (id, rider_id, driver_id, status)
    values ('${OPEN}', '${RIDER}', null, 'searching');
  `)
  await db.exec(migration)
  await db.exec(migration)
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

test('pickup code migration is additive, named for Ops, and not a production apply', () => {
  assert.match(file, /OPS_APPLY_trip_pickup_codes/)
  assert.match(migration, /CoS \/ Ops: apply this file manually/)
  assert.match(migration, /does not apply it to production/)
  assert.match(migration, /create table if not exists public\.trip_pickup_codes/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /trip_pickup_code_visible/)
  assert.match(migration, new RegExp(PICKUP_CODE_ALPHABET))
  assert.match(migration, /security definer/)
  assert.doesNotMatch(migration, /supabase db push|awktabuhijrshmsmagpq/i)
  assert.equal(migration.toLowerCase().includes('delete from'), false)
  assert.equal(migration.toLowerCase().includes('truncate'), false)
})

test('a code is created at match time and only the rider and matched driver can read it', async () => {
  const db = await harness()
  try {
    const before = await db.query('select code from public.trip_pickup_codes where trip_id = $1', [OPEN])
    assert.equal(before.rows.length, 0)

    await db.query(
      `insert into public.trips (id, rider_id, driver_id, status) values ($1, $2, $3, 'accepted')`,
      [TRIP, RIDER, DRIVER],
    )
    const created = await db.query('select code from public.trip_pickup_codes where trip_id = $1', [TRIP])
    assert.equal(created.rows.length, 1)
    assert.match(created.rows[0].code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}$/)
    const first = created.rows[0].code

    await db.query(`update public.trips set driver_id = $2 where id = $1`, [TRIP, OTHER])
    const kept = await db.query('select code from public.trip_pickup_codes where trip_id = $1', [TRIP])
    assert.equal(kept.rows[0].code, first)
    await db.query(`update public.trips set driver_id = $2 where id = $1`, [TRIP, DRIVER])

    const samples = await db.query(`select public.generate_pickup_code() as code from generate_series(1, 40)`)
    for (const row of samples.rows) {
      assert.match(row.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}$/)
      assert.equal(/[O0I1]/.test(row.code), false)
    }

    const rider = await asUser(db, RIDER, 'select code from public.trip_pickup_codes where trip_id = $1', [TRIP])
    assert.equal(rider.rows[0].code, first)
    const driver = await asUser(db, DRIVER, 'select code from public.trip_pickup_codes where trip_id = $1', [TRIP])
    assert.equal(driver.rows[0].code, first)
    const other = await asUser(db, OTHER, 'select code from public.trip_pickup_codes where trip_id = $1', [TRIP])
    assert.equal(other.rows.length, 0)

    await db.query(
      `insert into public.trip_pickup_codes (trip_id, code) values ($1, 'H4P')`,
      [OPEN],
    )
    const unmatched = await asUser(db, RIDER, 'select code from public.trip_pickup_codes where trip_id = $1', [OPEN])
    assert.equal(unmatched.rows.length, 0)

    await assert.rejects(
      () => asUser(db, OTHER, `insert into public.trip_pickup_codes (trip_id, code) values ($1, 'K7M')`, [TRIP]),
      /permission denied|row-level security/i,
    )
    await assert.rejects(
      () => asUser(db, RIDER, 'select public.generate_pickup_code()'),
      /permission denied/i,
    )

    await db.exec('set role anon')
    await assert.rejects(
      () => db.query('select code from public.trip_pickup_codes'),
      /permission denied/i,
    )
    await db.exec('reset role')

    const definer = await db.query(`
      select prosecdef from pg_proc where proname = 'assign_trip_pickup_code'
    `)
    assert.equal(definer.rows[0].prosecdef, true)
  } finally {
    await db.close()
  }
})
