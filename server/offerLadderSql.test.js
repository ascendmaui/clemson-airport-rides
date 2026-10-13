import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const original = await readFile(new URL('../supabase/migrations/20261004150000_matching_offer_deadline.sql', import.meta.url), 'utf8')
const ladder = await readFile(new URL('../supabase/migrations/20261005203000_offer_ladder_windows.sql', import.meta.url), 'utf8')

test('exclusive offers last 15 seconds and the pool lasts 2 minutes', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`CREATE TABLE public.trips (
    id text PRIMARY KEY, status text DEFAULT 'searching', driver_id text,
    metadata jsonb, deposit_cents integer DEFAULT 0, pickup_at timestamptz, scheduled_for timestamptz
  );`)
  await db.exec(original)
  await db.exec(ladder)
  await db.query(
    'INSERT INTO trips (id, metadata) VALUES ($1, $2)',
    ['exclusive', JSON.stringify({ kind: 'driver_request', offer_phase: 'exclusive', offer_driver_id: 'a' })],
  )
  const exclusive = await db.query(`
    SELECT offer_expires_at - clock_timestamp() BETWEEN interval '10 seconds' AND interval '15 seconds' AS window
    FROM trips WHERE id = 'exclusive'`)
  assert.equal(exclusive.rows[0].window, true)

  await db.query(`UPDATE trips SET metadata = metadata || $1::jsonb WHERE id = 'exclusive'`, [
    JSON.stringify({ offer_phase: 'pool', offer_driver_id: null, match: 'open' }),
  ])
  const pooled = await db.query(`
    SELECT offer_expires_at - clock_timestamp() BETWEEN interval '110 seconds' AND interval '120 seconds' AS window
    FROM trips WHERE id = 'pool' OR id = 'exclusive'`)
  assert.equal(pooled.rows[0].window, true)
  const held = (await db.query('SELECT offer_expires_at FROM trips WHERE id = $1', ['exclusive'])).rows[0].offer_expires_at
  await db.query(`UPDATE trips SET metadata = metadata || '{"seen":true}' WHERE id = 'exclusive'`)
  assert.equal((await db.query('SELECT offer_expires_at FROM trips WHERE id = $1', ['exclusive'])).rows[0].offer_expires_at.getTime(), held.getTime())

  await db.query(
    'INSERT INTO trips (id, status, metadata) VALUES ($1, $2, $3)',
    ['scheduled', 'scheduled', JSON.stringify({ kind: 'scheduled', offer_phase: 'scheduled' })],
  )
  assert.equal((await db.query('SELECT offer_expires_at FROM trips WHERE id = $1', ['scheduled'])).rows[0].offer_expires_at, null)
})
