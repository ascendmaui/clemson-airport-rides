import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION_PATH = new URL(
  '../supabase/migrations/20260925120000_ambassador_payout_unique.sql',
  import.meta.url,
)
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8')

const TRIP = '11111111-1111-4111-8111-111111111111'
const CODE = 'amb_tiger1'

let db

function errText(err) {
  return [err?.code, err?.message, err?.cause?.message, String(err)].filter(Boolean).join('\n')
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create table public.ambassador_payout_ledger (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      code_type text not null default 'ambassador',
      profile_id uuid,
      trip_id uuid,
      friend_ride_id uuid,
      seats integer not null default 0,
      amount_cents integer not null default 0,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      constraint ambassador_payout_ledger_code_type_check check (code_type = 'ambassador')
    );
  `)
  await db.exec(migrationSql)
})

test('migration adds a unique index on trip_id and code', async () => {
  assert.match(
    migrationSql,
    /create unique index if not exists ambassador_payout_ledger_trip_code_uniq\s+on public\.ambassador_payout_ledger \(trip_id, code\);/,
  )
  const { rows } = await db.query(`
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'ambassador_payout_ledger_trip_code_uniq'
  `)
  assert.equal(rows.length, 1)
  assert.match(rows[0].indexdef, /UNIQUE INDEX/i)
  assert.match(rows[0].indexdef, /\(trip_id, code\)/)
})

test('a second INSERT ... ON CONFLICT DO NOTHING leaves one row', async () => {
  const insert = `
    insert into public.ambassador_payout_ledger (code, code_type, trip_id, seats, amount_cents, status)
    values ($1, 'ambassador', $2::uuid, 2, 300, 'pending')
    on conflict (trip_id, code) do nothing
  `
  await db.query(insert, [CODE, TRIP])
  await db.query(insert, [CODE, TRIP])

  const { rows } = await db.query(
    'select code, trip_id::text as trip_id, amount_cents from public.ambassador_payout_ledger where trip_id = $1::uuid and code = $2',
    [TRIP, CODE],
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].code, CODE)
  assert.equal(rows[0].trip_id, TRIP)
  assert.equal(rows[0].amount_cents, 300)

  await assert.rejects(
    () => db.query(
      `insert into public.ambassador_payout_ledger (code, code_type, trip_id, seats, amount_cents)
       values ($1, 'ambassador', $2::uuid, 2, 300)`,
      [CODE, TRIP],
    ),
    (err) => {
      assert.match(errText(err), /23505|duplicate key value violates unique constraint/)
      return true
    },
  )
  const { rows: after } = await db.query(
    'select count(*)::int as n from public.ambassador_payout_ledger where trip_id = $1::uuid and code = $2',
    [TRIP, CODE],
  )
  assert.equal(after[0].n, 1)
})
