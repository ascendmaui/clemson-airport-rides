import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261012112103_flight_arrivals.sql', import.meta.url), 'utf8')
const driver = '00000000-0000-0000-0000-000000000001'
const rider = '00000000-0000-0000-0000-00000000000a'

async function fixture(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.ctx (uid uuid, role text);
    INSERT INTO auth.ctx VALUES (NULL, NULL);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.ctx $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM auth.ctx $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text);
    CREATE FUNCTION public.is_driver_or_admin_role() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('driver','admin')) $$;
    CREATE TABLE trips (id uuid PRIMARY KEY, rider_id uuid, status text, pickup_label text, dropoff_label text,
      flight text, scheduled_for timestamptz, pickup_at timestamptz, metadata jsonb);
  `)
  await db.exec(migration)
  await db.exec(migration)
  await db.query(`INSERT INTO profiles VALUES ($1,'driver'),($2,'rider')`, [driver, rider])
  return db
}

const as = (db, uid, role = 'authenticated') => db.query('UPDATE auth.ctx SET uid = $1, role = $2', [uid, role])
const waves = (db) => db.query(`SELECT * FROM public.airport_arrival_waves('GSP', 3, '2026-10-12T17:30:00Z')`).then((r) => r.rows)

test('waves bucket feed + booked pickups; booked pickups weigh 3x', async (t) => {
  const db = await fixture(t)
  await db.exec(`
    INSERT INTO flight_arrivals (airport, flight_number, flight_date, scheduled_at, estimated_at, provider) VALUES
      ('GSP','DL 1234','2026-10-12','2026-10-12T18:00:00Z','2026-10-12T18:25:00Z','aerodatabox'),
      ('GSP','AA 55','2026-10-12','2026-10-12T18:30:00Z',NULL,'aerodatabox'),
      ('GSP','UA 9','2026-10-12','2026-10-12T19:30:00Z',NULL,'aerodatabox'),
      ('GSP','WN 1','2026-10-12','2026-10-12T18:10:00Z',NULL,'aerodatabox');
    UPDATE flight_arrivals SET status = 'Canceled' WHERE flight_number = 'WN 1';
    INSERT INTO trips VALUES
      ('00000000-0000-0000-0000-0000000000b1','${rider}','scheduled','GSP Airport','Clemson','DL 1234','2026-10-12T18:00:00Z',NULL,'{"flight":{"number":"DL 1234"}}'),
      ('00000000-0000-0000-0000-0000000000b2','${rider}','scheduled','Clemson','GSP Airport','DL 999','2026-10-12T18:00:00Z',NULL,'{"flight":{"number":"DL 999"}}'),
      ('00000000-0000-0000-0000-0000000000b3','${rider}','accepted','Greenville-Spartanburg International','Clemson','B6 77','2026-10-12T19:05:00Z',NULL,'{}');
  `)
  await as(db, rider)
  assert.deepEqual(await waves(db), [], 'riders get nothing')
  await as(db, driver)
  const rows = await waves(db)
  const byStart = Object.fromEntries(rows.map((r) => [new Date(r.wave_start).toISOString(), r]))
  const w1 = byStart['2026-10-12T18:20:00.000Z']
  assert.equal(w1.flights, 2)
  assert.equal(w1.booked_pickups, 1, 'DL 1234 pickup follows the estimated 18:25 landing')
  assert.equal(Number(w1.score), 5)
  assert.equal(w1.data_quality, 'live')
  assert.equal(new Date(w1.stage_at).toISOString(), '2026-10-12T18:00:00.000Z')
  const w2 = byStart['2026-10-12T19:00:00.000Z']
  assert.equal(w2.booked_pickups, 1)
  assert.equal(w2.flights, 0)
  assert.equal(w2.data_quality, 'rider_entered')
  assert.equal(byStart['2026-10-12T18:00:00.000Z'], undefined, 'canceled flights and drop-offs are excluded')
  await as(db, null, 'service_role')
  assert.ok((await waves(db)).length >= 2)
})

test('apply_trip_flight_status merges metadata atomically and is idempotent', async (t) => {
  const db = await fixture(t)
  await db.exec(`INSERT INTO trips VALUES ('00000000-0000-0000-0000-0000000000c1','${rider}','scheduled','GSP','Clemson','DL 1',NULL,NULL,'{"flight":{"number":"DL 1"},"keep":1}')`)
  const s = { landing_at: '2026-10-12T18:25:00.000Z', landed: false }
  const first = await db.query(`SELECT public.apply_trip_flight_status('00000000-0000-0000-0000-0000000000c1', $1::jsonb) ok`, [JSON.stringify(s)])
  assert.equal(first.rows[0].ok, true)
  const again = await db.query(`SELECT public.apply_trip_flight_status('00000000-0000-0000-0000-0000000000c1', $1::jsonb) ok`, [JSON.stringify(s)])
  assert.equal(again.rows[0].ok, false)
  const meta = (await db.query(`SELECT metadata FROM trips`)).rows[0].metadata
  assert.equal(meta.keep, 1)
  assert.equal(meta.flight_status.landing_at, s.landing_at)
})

test('grants: feed readable by drivers via RLS; writer functions service-role only', () => {
  assert.match(migration, /flight_arrivals ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /USING \(public\.is_driver_or_admin_role\(\)\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_trip_flight_status\(uuid, jsonb\) FROM authenticated/)
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ''), /ALTER TABLE public\.trips|DROP TABLE/)
})
