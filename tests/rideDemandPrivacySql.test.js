import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261012130000_ride_demand_privacy.sql', import.meta.url),
  'utf8',
)
const RIDER = '00000000-0000-4000-8000-000000000001'
const E2E = '00000000-0000-4000-8000-000000000002'

async function harness() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_app_meta_data jsonb default '{}');
    create table public.profiles (id uuid primary key, email text);
    create table public.trips (
      id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid,
      pickup_lat float8, pickup_lng float8, requested_at timestamptz, scheduled_for timestamptz,
      metadata jsonb default '{}'
    );
    insert into auth.users values ('${RIDER}', '{}'), ('${E2E}', '{}');
    insert into public.profiles values ('${RIDER}', 'tiger@g.clemson.edu'), ('${E2E}', 'e2e+rider@clemsonrides.com');
    -- legacy definition was granted to anon
    create function public.get_ride_demand(p_from timestamptz default now() - interval '7 days', p_to timestamptz default now(), p_hour_start int default null, p_hour_end int default null)
      returns table(lat float8, lng float8, weight numeric, request_count bigint) language sql as $$ select 0::float8, 0::float8, 0::numeric, 0::bigint $$;
    grant execute on function public.get_ride_demand(timestamptz, timestamptz, int, int) to anon, authenticated, service_role;
  `)
  await db.exec(migration)
  await db.exec(migration)
  return db
}

async function add(db, n, { rider = RIDER, lat = 34.6760, lng = -82.8370, hoursAgo = 2, metadata = {} } = {}) {
  for (let i = 0; i < n; i += 1) {
    await db.query(
      `insert into public.trips (rider_id, pickup_lat, pickup_lng, requested_at, metadata) values ($1, $2, $3, now() - make_interval(hours => $4), $5)`,
      [rider, lat + i * 0.0001, lng, hoursAgo, metadata],
    )
  }
}

test('get_ride_demand: anon revoked, authenticated kept, e2e and QA excluded', async () => {
  const db = await harness()
  try {
    const sig = 'public.get_ride_demand(timestamptz, timestamptz, integer, integer)'
    const g = await db.query(`select has_function_privilege('anon', '${sig}', 'execute') a,
      has_function_privilege('authenticated', '${sig}', 'execute') u, has_function_privilege('service_role', '${sig}', 'execute') s`)
    assert.deepEqual(g.rows[0], { a: false, u: true, s: true })
    await add(db, 2)
    await add(db, 3, { rider: E2E })
    await add(db, 1, { metadata: { e2e_test: true } })
    await add(db, 1, { metadata: { qa_canceled: true } })
    const { rows } = await db.query('select sum(request_count)::int n from public.get_ride_demand()')
    assert.equal(rows[0].n, 2)
  } finally { await db.close() }
})

test('public_ride_demand_coarse: anon allowed, ~1 km cells, k>=3, 24h minimum lookback', async () => {
  const db = await harness()
  try {
    const sig = 'public.public_ride_demand_coarse(timestamptz, timestamptz, integer, integer)'
    assert.equal((await db.query(`select has_function_privilege('anon', '${sig}', 'execute') a`)).rows[0].a, true)
    await add(db, 3)                                   // dense cell
    await add(db, 2, { lat: 34.70, lng: -82.80 })      // sparse cell: suppressed
    await add(db, 4, { rider: E2E, lat: 34.70, lng: -82.80 })
    const { rows } = await db.query(`select * from public.public_ride_demand_coarse(now() - interval '5 minutes', now())`)
    assert.equal(rows.length, 1)
    assert.equal(Number(rows[0].request_count), 3)
    assert.equal(rows[0].lat, 34.68)
    assert.equal(rows[0].lng, -82.84)
  } finally { await db.close() }
})
