import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
test('returning an accepted/arriving pool ride to searching restores expiry without extending live offers', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`CREATE TABLE public.trips (id text PRIMARY KEY, status text, driver_id text, metadata jsonb, deposit_cents integer DEFAULT 0, pickup_at timestamptz, scheduled_for timestamptz);`)
  await db.exec(await migration('20261004150000_matching_offer_deadline.sql'))
  await db.exec(await migration('20261005203000_offer_ladder_windows.sql'))
  await db.exec(await migration('20261009170000_driver_cancel_pool_deadline.sql'))
  for (const status of ['accepted', 'arriving']) {
    await db.query('INSERT INTO trips (id,status,driver_id,metadata) VALUES ($1,$2,$3,$4)', [status, status, 'd1', JSON.stringify({ kind: 'driver_request', offer_phase: 'pool' })])
    assert.equal((await db.query('SELECT offer_expires_at FROM trips WHERE id=$1', [status])).rows[0].offer_expires_at, null)
    await db.query("UPDATE trips SET status='searching', driver_id=null WHERE id=$1", [status])
    assert.equal((await db.query("SELECT offer_expires_at - clock_timestamp() BETWEEN interval '110 seconds' AND interval '120 seconds' AS fresh FROM trips WHERE id=$1", [status])).rows[0].fresh, true)
    const first = (await db.query('SELECT offer_expires_at FROM trips WHERE id=$1', [status])).rows[0].offer_expires_at
    await db.query("UPDATE trips SET status='offered', metadata=metadata || '{\"seen\":true}', offer_expires_at=now()+interval '1 day' WHERE id=$1", [status])
    assert.equal((await db.query('SELECT offer_expires_at FROM trips WHERE id=$1', [status])).rows[0].offer_expires_at.getTime(), first.getTime())
    await db.query("UPDATE trips SET status='canceled' WHERE id=$1", [status])
    assert.equal((await db.query('SELECT offer_expires_at FROM trips WHERE id=$1', [status])).rows[0].offer_expires_at, null)
  }
})
