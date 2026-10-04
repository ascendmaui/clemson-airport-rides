import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const migration = readFileSync(new URL('../supabase/migrations/20261004160000_matching_decline_offline.sql', import.meta.url), 'utf8')
const a = '00000000-0000-0000-0000-000000000001'
const b = '00000000-0000-0000-0000-000000000002'
const c = '00000000-0000-0000-0000-000000000003'
const ride = '00000000-0000-0000-0000-000000000010'
async function fixture(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    CREATE TABLE profiles (id uuid PRIMARY KEY, email text, role text, is_admin boolean);
    CREATE TABLE driver_applications (profile_id uuid, onboarding_status text);
    CREATE TABLE admin_users (email text, access_role text);
    CREATE TABLE vehicles (driver_id uuid, is_tesla boolean, tier text, make text, model text);
    CREATE TABLE driver_status (driver_id uuid PRIMARY KEY, online boolean);
    CREATE TABLE trips (id uuid PRIMARY KEY, rider_id uuid, driver_id uuid, status text, tier text, pickup_at timestamptz, scheduled_for timestamptz, deposit_cents int, metadata jsonb);
    CREATE TABLE driver_offer_passes (trip_id uuid, driver_id uuid, PRIMARY KEY(trip_id, driver_id));
  `)
  await db.exec(migration)
  await db.exec(migration) // Reapplication is safe.
  for (const id of [a, b, c]) {
    await db.query('INSERT INTO profiles VALUES ($1, $2, $3, false)', [id, `${id}@test.invalid`, 'driver'])
    await db.query("INSERT INTO driver_applications VALUES ($1, 'approved')", [id])
    await db.query('INSERT INTO driver_status VALUES ($1, true)', [id])
  }
  await db.query("INSERT INTO trips(id,status,tier,deposit_cents,metadata) VALUES ($1,'offered','standard',0,$2)", [ride, {kind:'driver_request', offer_driver_id:a, auto_assign_queue:[a,b,c]}])
  return { db, trip: async () => (await db.query('SELECT * FROM trips WHERE id=$1', [ride])).rows[0],
    pass: async (id) => db.query('INSERT INTO driver_offer_passes VALUES ($1,$2) ON CONFLICT(trip_id,driver_id) DO UPDATE SET driver_id=excluded.driver_id', [ride,id]),
    accept: async (id) => db.query("UPDATE trips SET status='accepted', driver_id=$1 WHERE id=$2 AND driver_id IS NULL AND status IN ('searching','offered')", [id,ride]) }
}
test('native pass records retarget immediately; duplicate/stale passes cannot move the new target', async t => {
  const f = await fixture(t)
  await f.pass(a)
  assert.equal((await f.trip()).metadata.offer_driver_id,b)
  await f.pass(a)
  assert.equal((await f.trip()).metadata.offer_driver_id,b)
  await assert.rejects(f.accept(a), /offer changed/)
  await f.accept(b)
  await f.pass(b)
  assert.equal((await f.trip()).driver_id,b)
  assert.equal((await f.trip()).status,'accepted')
})
test('offline and deletion release unseen offers, preserve searching and exhaust into pool', async t => {
  const f = await fixture(t)
  await f.db.exec("UPDATE trips SET status='searching'")
  await f.db.query('UPDATE driver_status SET online=false WHERE driver_id=$1',[a])
  assert.equal((await f.trip()).metadata.offer_driver_id,b)
  await f.db.query('DELETE FROM driver_status WHERE driver_id=$1',[b])
  assert.equal((await f.trip()).metadata.offer_driver_id,c)
  await f.pass(c)
  const trip = await f.trip()
  assert.equal(trip.metadata.offer_driver_id,null)
  assert.equal(trip.status,'searching')
  assert.equal(trip.driver_id,null)
  await f.db.query('UPDATE driver_status SET online=true WHERE driver_id=$1',[a])
  await assert.rejects(f.accept(a), /offer changed/)
})
test('selection skips rider, unapproved, prior passes and incompatible fleet, including new arrivals', async t => {
  const f = await fixture(t)
  await f.db.query('UPDATE trips SET rider_id=$1',[b])
  await f.db.exec("UPDATE driver_applications SET onboarding_status='pending'")
  await f.pass(a)
  assert.equal((await f.trip()).metadata.offer_driver_id,null)
  // Reset with C newly eligible, outside the original queue.
  await f.db.query("UPDATE driver_applications SET onboarding_status='approved' WHERE profile_id=$1",[c])
  await f.db.query("UPDATE trips SET tier='tesla', metadata=$1",[{kind:'driver_request',offer_driver_id:a,auto_assign_queue:[a,b]}])
  await f.pass(a)
  assert.equal((await f.trip()).metadata.offer_driver_id,null)
  await f.db.query("INSERT INTO vehicles VALUES ($1,true,'tesla','Tesla','Model 3')",[c])
  await f.db.query('UPDATE trips SET metadata=$1',[{kind:'driver_request',offer_driver_id:a,auto_assign_queue:[a,b]}])
  await f.pass(a)
  assert.equal((await f.trip()).metadata.offer_driver_id,c)
})
test('accept-first wins; cancellation, scheduled and deposit rides remain unchanged', async t => {
  const f = await fixture(t)
  await f.accept(a)
  await f.db.query('UPDATE driver_status SET online=false WHERE driver_id=$1',[a])
  assert.equal((await f.trip()).status,'accepted')
  for (const patch of ["status='canceled'", "status='offered',pickup_at=now()", "pickup_at=null,scheduled_for=now()", "scheduled_for=null,deposit_cents=100"]) {
    await f.db.exec(`UPDATE trips SET driver_id=null, ${patch}`)
    const before = await f.trip()
    await f.pass(a)
    assert.deepEqual(await f.trip(),before)
  }
})
test('pool accepts require online presence and reject recorded passes', async t => {
  const f = await fixture(t)
  await f.db.exec(`UPDATE trips SET metadata='{"kind":"driver_request"}'`)
  await f.db.query('UPDATE driver_status SET online=false WHERE driver_id=$1',[a])
  await assert.rejects(f.accept(a), /Go online/)
  await f.pass(b)
  await assert.rejects(f.accept(b), /offer changed/)
  await f.accept(c)
  assert.equal((await f.trip()).driver_id,c)
})

test('retarget invalidates an already-read accept snapshot and a failed release rolls back presence', async t => {
  const f = await fixture(t)
  const old = await f.trip()
  await f.pass(a)
  const stale = await f.db.query("UPDATE trips SET status='accepted',driver_id=$1 WHERE id=$2 AND metadata=$3 RETURNING id",[a,ride,old.metadata])
  assert.equal(stale.rows.length,0)
  await f.db.exec(`CREATE FUNCTION fail_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$;
    CREATE TRIGGER fail_release BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION fail_release();`)
  await assert.rejects(f.db.query('UPDATE driver_status SET online=false WHERE driver_id=$1',[b]), /injected failure/)
  assert.equal((await f.db.query('SELECT online FROM driver_status WHERE driver_id=$1',[b])).rows[0].online,true)
  assert.equal((await f.trip()).metadata.offer_driver_id,b)
})
