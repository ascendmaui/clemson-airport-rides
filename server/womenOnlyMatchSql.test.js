import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const prior = readFileSync(new URL('../supabase/migrations/20261004160000_matching_decline_offline.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20261005193000_women_only_matching.sql', import.meta.url), 'utf8')
const rider = '00000000-0000-0000-0000-00000000000a'
const man = '00000000-0000-0000-0000-000000000001'
const otherMan = '00000000-0000-0000-0000-000000000002'
const woman = '00000000-0000-0000-0000-000000000003'
const ride = '00000000-0000-0000-0000-000000000010'

async function fixture(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    CREATE TABLE profiles (id uuid PRIMARY KEY, email text, role text, is_admin boolean);
    CREATE TABLE driver_applications (profile_id uuid, onboarding_status text);
    CREATE TABLE admin_users (email text, access_role text);
    CREATE TABLE driver_status (driver_id uuid PRIMARY KEY, online boolean);
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
  `)
  await db.exec(prior)
  await db.exec(migration)
  await db.exec(migration)
  const people = [
    [rider, 'rider@clemson.edu', 'rider', 'woman', true],
    [man, 'man@example.com', 'driver', 'man', false],
    [otherMan, 'other@example.com', 'driver', 'man', false],
    [woman, 'woman@example.com', 'driver', 'woman', false],
  ]
  for (const [id, email, role, gender, wants] of people) {
    await db.query(
      'INSERT INTO profiles (id, email, role, is_admin, gender_identity, women_only_matching) VALUES ($1,$2,$3,false,$4,$5)',
      [id, email, role, gender, wants],
    )
  }
  for (const id of [man, otherMan, woman]) {
    await db.query("INSERT INTO driver_applications VALUES ($1, 'approved')", [id])
    await db.query('INSERT INTO driver_status VALUES ($1, true)', [id])
  }
  await db.query(
    "INSERT INTO trips (id, rider_id, status, tier, deposit_cents, metadata) VALUES ($1,$2,'offered','standard',0,$3)",
    [ride, rider, { kind: 'driver_request', offer_driver_id: man, auto_assign_queue: [man, otherMan, woman] }],
  )
  return {
    db,
    trip: async () => (await db.query('SELECT * FROM trips WHERE id=$1', [ride])).rows[0],
    pass: (id) => db.query(
      'INSERT INTO driver_offer_passes VALUES ($1,$2) ON CONFLICT (trip_id, driver_id) DO UPDATE SET driver_id = excluded.driver_id',
      [ride, id],
    ),
    accept: (id) => db.query(
      "UPDATE trips SET status='accepted', driver_id=$1 WHERE id=$2 AND driver_id IS NULL AND status IN ('searching','offered')",
      [id, ride],
    ),
  }
}

test('a pass skips drivers who do not match the rider comfort preference', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.accept(man), /women-only comfort preference/)
  await f.pass(man)
  const trip = await f.trip()
  assert.equal(trip.metadata.offer_driver_id, woman)
  assert.equal(trip.status, 'searching')
  await f.accept(woman)
  assert.equal((await f.trip()).driver_id, woman)
})

test('a woman driver preference skips passengers who are not women, and carpool insert stays chosen', async (t) => {
  const f = await fixture(t)
  await f.db.query('UPDATE profiles SET gender_identity=$2, women_only_matching=false WHERE id=$1', [rider, 'man'])
  await f.db.query('UPDATE profiles SET women_only_matching=true WHERE id=$1', [woman])
  await f.db.query('UPDATE trips SET metadata=$1', [{
    kind: 'driver_request',
    offer_driver_id: woman,
    auto_assign_queue: [woman, man],
  }])
  await f.pass(woman)
  assert.equal((await f.trip()).metadata.offer_driver_id, man)
  await assert.rejects(
    f.db.query(
      "INSERT INTO trips (id, rider_id, driver_id, status, metadata) VALUES ($1,$2,$3,'accepted',$4)",
      ['00000000-0000-0000-0000-000000000099', rider, woman, { kind: 'driver_request' }],
    ),
    /women-only comfort preference/,
  )
  await f.db.query(
    "INSERT INTO trips (id, rider_id, driver_id, status, metadata) VALUES ($1,$2,$3,'accepted',$4)",
    ['00000000-0000-0000-0000-000000000098', rider, woman, { kind: 'carpool' }],
  )
})

test('the preference column rejects a non-woman who tries to turn it on', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.db.query('UPDATE profiles SET women_only_matching=true WHERE id=$1', [man]),
    /profiles_women_only_requires_woman|check constraint/i,
  )
})
