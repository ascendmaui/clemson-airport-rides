import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261007131000_comfort_retarget_vehicle.sql', import.meta.url), 'utf8')

const rider = '00000000-0000-0000-0000-00000000000a'
const passing = '00000000-0000-0000-0000-000000000001'
const standard = '00000000-0000-0000-0000-000000000002'
const comfort = '00000000-0000-0000-0000-000000000003'
const comfortTier = '00000000-0000-0000-0000-000000000004'
const blocked = '00000000-0000-0000-0000-000000000005'
const ride = '00000000-0000-0000-0000-000000000010'

async function fixture(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    CREATE TABLE profiles (id uuid PRIMARY KEY, email text, role text, is_admin boolean);
    CREATE TABLE driver_applications (profile_id uuid, onboarding_status text);
    CREATE TABLE admin_users (email text, access_role text);
    CREATE TABLE driver_status (driver_id uuid PRIMARY KEY, online boolean);
    CREATE TABLE vehicles (driver_id uuid, service_class text, tier text);
    CREATE TABLE trips (
      id uuid PRIMARY KEY,
      rider_id uuid,
      driver_id uuid,
      status text,
      tier text,
      pickup_at timestamptz,
      scheduled_for timestamptz,
      deposit_cents int,
      metadata jsonb
    );
    CREATE TABLE driver_offer_passes (trip_id uuid, driver_id uuid, PRIMARY KEY (trip_id, driver_id));
    CREATE FUNCTION public.women_only_pair_allowed(p_rider uuid, p_driver uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT p_driver IS DISTINCT FROM '${blocked}'::uuid
    $$;
  `)
  await db.exec(migration)
  await db.exec(migration)
  const people = [rider, passing, standard, comfort, comfortTier, blocked]
  for (const id of people) {
    await db.query(
      'INSERT INTO profiles (id, email, role, is_admin) VALUES ($1, $2, $3, false)',
      [id, `${id.slice(0, 8)}@example.com`, id === rider ? 'rider' : 'driver'],
    )
  }
  for (const id of [passing, standard, comfort, comfortTier, blocked]) {
    await db.query("INSERT INTO driver_applications VALUES ($1, 'approved')", [id])
    await db.query('INSERT INTO driver_status VALUES ($1, true)', [id])
  }
  await db.query("INSERT INTO vehicles VALUES ($1, 'standard', 'standard')", [passing])
  await db.query("INSERT INTO vehicles VALUES ($1, 'standard', 'standard')", [standard])
  await db.query("INSERT INTO vehicles VALUES ($1, 'comfort', 'standard')", [comfort])
  await db.query("INSERT INTO vehicles VALUES ($1, 'standard', 'comfort')", [comfortTier])
  await db.query("INSERT INTO vehicles VALUES ($1, 'comfort', 'comfort')", [blocked])
  await db.query("INSERT INTO vehicles VALUES ($1, 'true', 'standard')", [standard])
  return db
}

function queue(ids) {
  return {
    kind: 'driver_request',
    offer_driver_id: passing,
    auto_assign_queue: [passing, ...ids],
  }
}

async function offer(db, tier, ids) {
  await db.query('DELETE FROM trips WHERE id = $1', [ride])
  await db.query(
    'INSERT INTO trips (id, rider_id, status, tier, deposit_cents, metadata) VALUES ($1,$2,$3,$4,0,$5)',
    [ride, rider, 'offered', tier, queue(ids)],
  )
  await db.query('SELECT public.release_matching_offer($1,$2,$3)', [ride, passing, 'driver_decline'])
  const trip = (await db.query('SELECT status, metadata FROM trips WHERE id = $1', [ride])).rows[0]
  return trip.metadata.offer_driver_id
}

test('comfort retarget skips a standard vehicle and keeps standard and wait order', async (t) => {
  const db = await fixture(t)
  assert.equal(await offer(db, 'comfort', [standard, comfort]), comfort)
  assert.equal(await offer(db, 'standard', [standard, comfort]), standard)
  assert.equal(await offer(db, 'wait', [standard, comfort]), standard)
  assert.equal(await offer(db, 'comfort', [comfortTier]), comfortTier)
  assert.equal(await offer(db, 'comfort', [blocked, comfort]), comfort)
  await db.query('UPDATE driver_status SET online = false WHERE driver_id = ANY($1::uuid[])', [[comfort, comfortTier, blocked]])
  assert.equal(await offer(db, 'comfort', [standard]), null)
})
