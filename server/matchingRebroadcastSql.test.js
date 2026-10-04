import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261004150000_matching_offer_deadline.sql', import.meta.url), 'utf8')

test('real PostgreSQL deadline trigger: backfill, target changes, no extension, terminal cleanup', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`CREATE TABLE public.trips (
    id text PRIMARY KEY, status text DEFAULT 'searching', driver_id text,
    metadata jsonb, deposit_cents integer DEFAULT 0, pickup_at timestamptz, scheduled_for timestamptz
  );
  INSERT INTO trips (id, metadata) VALUES ('legacy', '{"kind":"driver_request","offer_driver_id":"a"}');`)
  await db.exec(migration)
  const row = async (id = 'legacy') => (await db.query('SELECT * FROM trips WHERE id = $1', [id])).rows[0]
  const first = await row()
  assert.ok(first.offer_expires_at instanceof Date)
  const remaining = await db.query("SELECT offer_expires_at - clock_timestamp() BETWEEN interval '55 seconds' AND interval '60 seconds' AS full_window FROM trips")
  assert.equal(remaining.rows[0].full_window, true)
  await db.exec("UPDATE trips SET status = 'offered', offer_expires_at = now() + interval '1 day'")
  assert.equal((await row()).offer_expires_at.getTime(), first.offer_expires_at.getTime())
  await db.exec("UPDATE trips SET metadata = metadata || '{\"other\":true}'")
  assert.equal((await row()).offer_expires_at.getTime(), first.offer_expires_at.getTime())
  await db.exec("UPDATE trips SET metadata = metadata || '{\"offer_driver_id\":\"b\"}'")
  assert.ok((await row()).offer_expires_at.getTime() >= first.offer_expires_at.getTime())
  await db.exec("UPDATE trips SET status = 'accepted', driver_id = 'b'")
  assert.equal((await row()).offer_expires_at, null)

  for (const [id, patch] of [
    ['open', { metadata: { kind: 'driver_request' } }],
    ['deposit', { deposit_cents: 100 }],
    ['scheduled', { status: 'scheduled' }],
    ['future', { pickup_at: '2026-12-01T00:00:00Z' }],
    ['canceled', { status: 'canceled' }],
  ]) {
    const input = { id, status: 'searching', metadata: { kind: 'driver_request', offer_driver_id: 'a' }, deposit_cents: 0, pickup_at: null, ...patch }
    await db.query('INSERT INTO trips (id, status, metadata, deposit_cents, pickup_at) VALUES ($1, $2, $3, $4, $5)', [id, input.status, JSON.stringify(input.metadata), input.deposit_cents, input.pickup_at])
    assert.equal((await row(id)).offer_expires_at, null)
  }
  // Safe to apply again; terminal rows are not reactivated.
  await db.exec(migration)
  assert.equal((await row()).offer_expires_at, null)
})

test('PostgreSQL conditional claims preserve one winner in both timeout/accept orders', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`CREATE TABLE public.trips (
    id text PRIMARY KEY, status text DEFAULT 'searching', driver_id text,
    metadata jsonb, deposit_cents integer DEFAULT 0, pickup_at timestamptz, scheduled_for timestamptz
  );`)
  await db.exec(migration)
  const initial = { kind: 'driver_request', offer_driver_id: 'a' }
  for (const first of ['accept', 'timeout', 'cancel']) {
    await db.query('INSERT INTO trips (id, metadata) VALUES ($1, $2)', [first, JSON.stringify(initial)])
    const snapshot = (await db.query('SELECT * FROM trips WHERE id=$1', [first])).rows[0]
    const accept = () => db.query("UPDATE trips SET status='accepted', driver_id='a' WHERE id=$1 AND driver_id IS NULL AND status IN ('searching','offered') AND metadata=$2::jsonb RETURNING id", [first, JSON.stringify(initial)])
    const timeout = () => db.query("UPDATE trips SET status='searching', metadata=metadata || '{\"offer_driver_id\":\"b\"}' WHERE id=$1 AND driver_id IS NULL AND status IN ('searching','offered') AND metadata=$2::jsonb AND offer_expires_at=$3 RETURNING id", [first, JSON.stringify(initial), snapshot.offer_expires_at])
    // Preserve timestamp microseconds when binding, just as PostgREST does.
    const deadline = (await db.query('SELECT offer_expires_at::text AS deadline FROM trips WHERE id=$1', [first])).rows[0].deadline
    snapshot.offer_expires_at = deadline
    if (first === 'accept') {
      assert.equal((await accept()).rows.length, 1)
      assert.equal((await timeout()).rows.length, 0)
    } else if (first === 'timeout') {
      assert.equal((await timeout()).rows.length, 1)
      assert.equal((await timeout()).rows.length, 0)
      assert.equal((await accept()).rows.length, 0)
    } else {
      await db.query("UPDATE trips SET status='canceled' WHERE id=$1", [first])
      assert.equal((await timeout()).rows.length, 0)
      assert.equal((await accept()).rows.length, 0)
    }
  }
})
