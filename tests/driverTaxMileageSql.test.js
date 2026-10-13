import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { mileageFromTrip } from '../shared/driverTaxMileage.js'

const migration = readFileSync(new URL('../supabase/migrations/20261012235000_driver_tax_mileage.sql', import.meta.url), 'utf8')

const DRIVER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const TRIP = '33333333-3333-4333-8333-333333333333'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
    end $$;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.profiles (id uuid primary key);
    create table public.trips (
      id uuid primary key,
      driver_id uuid references public.profiles(id),
      rider_id uuid,
      status text,
      pickup_label text,
      dropoff_label text,
      pickup_lat double precision,
      pickup_lng double precision,
      dropoff_lat double precision,
      dropoff_lng double precision,
      completed_at timestamptz,
      canceled_at timestamptz,
      metadata jsonb
    );
    create table public.driver_status (
      driver_id uuid primary key,
      lat double precision,
      lng double precision,
      online boolean
    );
    insert into public.profiles values ('${DRIVER}'), ('${OTHER}');
  `)
  await db.exec(migration)
  return db
}

test('mileage function matches the shared trip split and the trigger keeps en route after completion', async () => {
  const db = await setup()
  try {
    const js = mileageFromTrip({
      status: 'completed',
      metadata: { route_distance_m: 3218.688, enroute_distance_m: 1609.344 },
    })
    const sql = await db.query(
      `select public.driver_trip_mileage($1, $2::jsonb, null, null, null, null, null, null, false) as calc`,
      ['completed', JSON.stringify({ route_distance_m: 3218.688, enroute_distance_m: 1609.344 })],
    )
    const calc = sql.rows[0].calc
    assert.equal(Number(calc.on_trip_miles), js.onTripMiles)
    assert.equal(calc.on_trip_source, 'routed')
    assert.equal(Number(calc.enroute_miles), js.enrouteMiles)
    assert.equal(calc.enroute_source, 'routed')

    await db.query(
      `insert into public.driver_status (driver_id, lat, lng, online) values ($1, 34.6934, -82.8374, true)`,
      [DRIVER],
    )
    await db.query(
      `insert into public.trips (id, driver_id, status, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, metadata)
       values ($1, $2, 'searching', 'Cooper Library', 'GSP', 34.6834, -82.8374, 34.8957, -82.2189, '{}'::jsonb)`,
      [TRIP, DRIVER],
    )
    await db.query(`update public.trips set status = 'accepted', metadata = '{"route_distance_m":1609.344}'::jsonb where id = $1`, [TRIP])
    const accepted = (await db.query(`select * from public.driver_mileage_logs where trip_id = $1`, [TRIP])).rows[0]
    assert.equal(accepted.enroute_source, 'straight_line')
    assert.ok(Number(accepted.enroute_miles) > 0.6 && Number(accepted.enroute_miles) < 0.8)
    assert.equal(accepted.on_trip_source, 'unavailable')

    await db.query(
      `update public.trips set status = 'completed', completed_at = '2026-08-15T18:00:00Z' where id = $1`,
      [TRIP],
    )
    const done = (await db.query(`select * from public.driver_mileage_logs where trip_id = $1`, [TRIP])).rows[0]
    assert.equal(done.on_trip_source, 'routed')
    assert.equal(Number(done.on_trip_miles), 1)
    assert.equal(done.enroute_source, 'straight_line')
    assert.equal(Number(done.deductible_miles), Number((1 + Number(accepted.enroute_miles)).toFixed(2)))
    assert.equal(Number(done.tax_year), 2026)

    const rates = await db.query(`select cents_per_mile::float8 as cents from public.driver_mileage_rates where starts_on = '2026-07-01'`)
    assert.equal(rates.rows[0].cents, 76)
  } finally {
    await db.close()
  }
})

test('drivers can read only their own mileage log and cannot write the rate config', async () => {
  const db = await setup()
  try {
    await db.exec(`
      insert into public.driver_status (driver_id, lat, lng, online) values ('${DRIVER}', 34.69, -82.84, true);
      insert into public.trips (id, driver_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, completed_at, metadata)
      values ('${TRIP}', '${DRIVER}', 'completed', 34.68, -82.84, 34.70, -82.84, '2026-02-01T18:00:00Z', '{"route_distance_m":1609.344}');
    `)
    const otherTrip = '44444444-4444-4444-8444-444444444444'
    await db.query(
      `insert into public.trips (id, driver_id, status, completed_at, metadata, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
       values ($1, $2, 'completed', '2026-02-02T18:00:00Z', '{"distance_m":1609.344}', 1, 1, 2, 2)`,
      [otherTrip, OTHER],
    )
    await db.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated;
        end if;
      end $$;
      grant usage on schema public to authenticated;
      grant select on public.driver_mileage_logs to authenticated;
      grant select on public.driver_mileage_rates to authenticated;
    `)
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [DRIVER])
    await db.exec('set role authenticated')
    const mine = await db.query('select trip_id from public.driver_mileage_logs')
    assert.deepEqual(mine.rows.map((row) => row.trip_id), [TRIP])
    const rates = await db.query('select count(*)::int as n from public.driver_mileage_rates')
    assert.ok(rates.rows[0].n >= 4)
    await assert.rejects(
      db.query(`update public.driver_mileage_rates set cents_per_mile = 1`),
      /permission denied|row-level security/i,
    )
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OTHER])
    await db.exec('set role authenticated')
    const theirs = await db.query('select trip_id from public.driver_mileage_logs')
    assert.deepEqual(theirs.rows.map((row) => row.trip_id), [otherTrip])
  } finally {
    await db.close()
  }
})
