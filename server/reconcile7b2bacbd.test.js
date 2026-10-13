import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261010150000_reconcile_trip_7b2bacbd.sql', import.meta.url), 'utf8')
const TRIP = '7b2bacbd-3439-4294-9c78-ef3305888547'
const PAY = '37c4cbdb-da65-49dd-a50d-61d3dfee6ea2'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create table public.trips (id uuid primary key, status text, payment_status text, metadata jsonb);
    create table public.payments (id uuid primary key, trip_id uuid, status text, kind text, amount_cents int, stripe_payment_intent_id text);
    insert into trips values
      ('${TRIP}', 'canceled', 'paid', '{"e2e_test": true, "fare_authorization": {"status": "canceled", "paymentIntentId": "pi_3UOfB86GhxbWOrW80CjS2jPY"}}'),
      ('00000000-0000-0000-0000-000000000001', 'canceled', 'paid', '{"fare_authorization": {"status": "canceled"}}');
    insert into payments values
      ('${PAY}', '${TRIP}', 'pending', 'balance', 1032, 'pi_3UOfB86GhxbWOrW80CjS2jPY'),
      ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', 'pending', 'balance', 900, 'pi_other');
  `)
  return db
}

test('reconcile closes only the leftover hold row and un-pays only that trip', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  await db.exec(sql)
  await db.exec(sql) // re-run is a no-op
  const trips = (await db.query('select id, payment_status, metadata from trips order by id')).rows
  const pays = (await db.query('select id, status from payments order by id')).rows
  assert.equal(trips.find((r) => r.id === TRIP).payment_status, 'no_charge')
  assert.equal(trips.find((r) => r.id === TRIP).metadata.payment_reconciliation.previous_payment_status, 'paid')
  assert.equal(trips.find((r) => r.id === TRIP).metadata.e2e_test, true)
  assert.equal(trips.find((r) => r.id !== TRIP).payment_status, 'paid')
  assert.equal(pays.find((r) => r.id === PAY).status, 'canceled')
  assert.equal(pays.find((r) => r.id !== PAY).status, 'pending')
})
