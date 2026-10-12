import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261012120000_driver_demand_cells.sql', import.meta.url),
  'utf8',
)

const RIDER = '00000000-0000-4000-8000-000000000001'
const E2E_RIDER = '00000000-0000-4000-8000-000000000002'
const META_E2E = '00000000-0000-4000-8000-000000000003'
const DRIVER = '00000000-0000-4000-8000-0000000000d1'

async function harness() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_app_meta_data jsonb default '{}');
    create table public.app_caller (is_driver boolean);
    insert into public.app_caller values (true);
    create function public.is_driver_or_admin_role() returns boolean
      language sql stable as $$ select is_driver from public.app_caller limit 1 $$;
    create table public.profiles (id uuid primary key, email text);
    create type public.trip_status as enum ('searching','offered','accepted','arriving','in_progress','completed','canceled','scheduled','canceled_midride','arrived','cancelled_wait');
    create table public.trips (
      id uuid primary key default gen_random_uuid(),
      rider_id uuid, driver_id uuid, status public.trip_status,
      pickup_lat float8, pickup_lng float8, flight text,
      requested_at timestamptz, created_at timestamptz default now(),
      pickup_at timestamptz, completed_at timestamptz, scheduled_for timestamptz,
      metadata jsonb default '{}'
    );
    insert into auth.users values ('${RIDER}', '{}'), ('${E2E_RIDER}', '{}'), ('${META_E2E}', '{"e2e_test": true}'), ('${DRIVER}', '{}');
    insert into public.profiles values
      ('${RIDER}', 'tiger@g.clemson.edu'),
      ('${E2E_RIDER}', 'e2e+rider@clemsonrides.com'),
      ('${META_E2E}', 'qa@g.clemson.edu'),
      ('${DRIVER}', 'driver@g.clemson.edu');
  `)
  await db.exec(migration)
  await db.exec(migration)
  return db
}

async function trip(db, fields) {
  const cols = Object.keys(fields)
  const vals = cols.map((c) => fields[c])
  const marks = cols.map((c, i) => `$${i + 1}${c === 'status' ? '::public.trip_status' : ''}`)
  await db.query(`insert into public.trips (${cols.join(',')}) values (${marks.join(',')})`, vals)
}

const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
const ahead = (min) => new Date(Date.now() + min * 60000).toISOString()
const COOPER = { pickup_lat: 34.67601, pickup_lng: -82.83701 }
const DOWNTOWN = { pickup_lat: 34.68301, pickup_lng: -82.83701 }

test('aggregates recent asks into snapped grid cells with decay and no identities', async () => {
  const db = await harness()
  try {
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(1), ...COOPER })
    await trip(db, { rider_id: RIDER, status: 'offered', requested_at: ago(2), pickup_lat: 34.67609, pickup_lng: -82.83709 })
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(9), ...DOWNTOWN })
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(45), ...DOWNTOWN }) // outside window
    const { rows, fields } = await db.query('select * from public.driver_demand_cells(20, false)')
    assert.deepEqual(fields.map((f) => f.name), ['cell_id', 'lat', 'lng', 'demand', 'requests', 'pickups', 'scheduled', 'airport', 'window_minutes', 'generated_at'])
    assert.equal(rows.length, 2)
    const [hot, warm] = rows
    assert.equal(hot.requests, 2)
    assert.equal(warm.requests, 1)
    assert.ok(Number(hot.demand) > Number(warm.demand))
    assert.ok(Number(warm.demand) < 1 && Number(warm.demand) > 0.4, `decayed ${warm.demand}`)
    // centers are grid-snapped, never the raw pickup coordinates
    assert.notEqual(hot.lat, COOPER.pickup_lat)
    assert.ok(Math.abs(hot.lat - COOPER.pickup_lat) <= 0.00125 + 1e-9)
    assert.ok(Math.abs(hot.lng - COOPER.pickup_lng) <= 0.0015 + 1e-9)
  } finally { await db.close() }
})

test('counts pickups, scheduled, and airport demand; excludes e2e and QA trips', async () => {
  const db = await harness()
  try {
    await trip(db, { rider_id: RIDER, driver_id: DRIVER, status: 'completed', pickup_at: ago(5), completed_at: ago(1), ...COOPER })
    await trip(db, { rider_id: RIDER, status: 'scheduled', scheduled_for: ahead(30), ...COOPER })
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(1), flight: 'DL123', ...DOWNTOWN })
    await trip(db, { rider_id: E2E_RIDER, status: 'searching', requested_at: ago(1), ...COOPER })
    await trip(db, { rider_id: META_E2E, status: 'searching', requested_at: ago(1), ...COOPER })
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(1), metadata: { e2e_test: true }, ...COOPER })
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(1), metadata: { qa_canceled: true }, ...COOPER })
    await trip(db, { rider_id: RIDER, status: 'canceled', requested_at: ago(1), ...COOPER })
    const { rows } = await db.query('select * from public.driver_demand_cells(20, false) order by cell_id')
    const byReq = Object.fromEntries(rows.map((r) => [r.requests > 0 ? 'downtown' : 'cooper', r]))
    assert.equal(byReq.cooper.requests, 0)
    assert.equal(byReq.cooper.pickups, 1)
    assert.equal(byReq.cooper.scheduled, 1)
    assert.equal(byReq.downtown.requests, 1)
    assert.equal(byReq.downtown.airport, 1)
    assert.ok(Number(byReq.downtown.demand) > 1.3)

    const peak = await db.query('select * from public.driver_demand_cells(10, true)')
    assert.equal(peak.rows[0].window_minutes, 30)
    assert.ok(Number(peak.rows.find((r) => r.airport > 0).demand) > 1.8)
  } finally { await db.close() }
})

test('non-drivers get no rows and anon cannot execute', async () => {
  const db = await harness()
  try {
    await trip(db, { rider_id: RIDER, status: 'searching', requested_at: ago(1), ...COOPER })
    await db.exec('update public.app_caller set is_driver = false')
    assert.equal((await db.query('select * from public.driver_demand_cells()')).rows.length, 0)
    const grants = await db.query(`select
      has_function_privilege('anon', 'public.driver_demand_cells(integer, boolean)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.driver_demand_cells(integer, boolean)', 'execute') as auth`)
    assert.deepEqual(grants.rows[0], { anon: false, auth: true })
  } finally { await db.close() }
})
