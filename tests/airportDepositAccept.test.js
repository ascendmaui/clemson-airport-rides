import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR } from '../packages/rides-native/tripTags.js'

const MIGRATION_PATH = new URL(
  '../supabase/migrations/20260924233000_block_unpaid_airport_deposit_accept.sql',
  import.meta.url,
)
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8')

const DRIVER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RIDER = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

let db
let tripSeq = 0

function errText(err) {
  return [err?.message, err?.cause?.message, String(err)].filter(Boolean).join('\n')
}

async function rejectsWith(run, pattern) {
  await assert.rejects(run, (err) => {
    assert.match(errText(err), pattern)
    return true
  })
}

async function seed(overrides = {}) {
  tripSeq += 1
  const id = overrides.id || `00000000-0000-4000-8000-${String(tripSeq).padStart(12, '0')}`
  const row = {
    status: 'searching',
    driver_id: null,
    rider_note: null,
    deposit_cents: 2500,
    metadata: { kind: 'airport', purpose: 'airport', airport: 'GSP' },
    pickup_at: null,
    pickup_label: 'Campus',
    dropoff_label: 'GSP',
    fare_cents: 10000,
    ...overrides,
    id,
  }
  await db.query(
    `INSERT INTO public.trips (
       id, status, driver_id, rider_id, rider_note, deposit_cents, metadata,
       pickup_at, pickup_label, dropoff_label, fare_cents
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::jsonb,
       $8::timestamptz, $9, $10, $11
     )`,
    [
      row.id,
      row.status,
      row.driver_id,
      RIDER,
      row.rider_note,
      row.deposit_cents,
      JSON.stringify(row.metadata),
      row.pickup_at,
      row.pickup_label,
      row.dropoff_label,
      row.fare_cents,
    ],
  )
  return id
}

async function tripOf(id) {
  const { rows } = await db.query(
    'SELECT status, driver_id::text AS driver_id, deposit_cents, metadata FROM public.trips WHERE id = $1::uuid',
    [id],
  )
  return rows[0]
}

async function claim(id, status = 'accepted') {
  await db.query(
    'UPDATE public.trips SET status = $2, driver_id = $3::uuid, accepted_at = now() WHERE id = $1::uuid',
    [id, status, DRIVER],
  )
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      role text NOT NULL
    );

    CREATE TABLE public.trips (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      driver_id uuid,
      rider_id uuid,
      rider_note text,
      deposit_cents integer,
      metadata jsonb,
      pickup_at timestamptz,
      accepted_at timestamptz,
      pickup_label text,
      dropoff_label text,
      fare_cents integer,
      canceled_at timestamptz
    );

    CREATE TABLE public.trip_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid NOT NULL,
      kind text NOT NULL,
      payload jsonb
    );

    INSERT INTO public.profiles (id, role) VALUES ('${DRIVER}', 'driver');
  `)
  await db.exec(migrationSql)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [DRIVER])
})

test('migration raises the same unpaid-deposit sentence as the driver desk', () => {
  assert.match(migrationSql, new RegExp(UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR.replace(/[.]/g, '\\.')))
  assert.equal(
    UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR,
    'Airport deposit still unpaid. This ride is not claimable until the rider pays the deposit.',
  )
})

test('predicate matches paid stamps, fare coverage, zero deposit, and non-airport rows', async () => {
  const cases = [
    [2500, null, { purpose: 'airport', airport: 'GSP' }, true],
    [2500, null, { kind: 'airport' }, true],
    [2500, 'Airport', {}, true],
    [2500, null, { airport: 'GSP', fare_paid_cents: 2500 }, false],
    [2500, null, { airport: 'GSP', fare_paid_cents: 2499 }, true],
    [2500, null, { airport: 'GSP', fare_paid_cents: '2500' }, false],
    [2500, null, { airport: 'GSP', checkout_deposit: { session_id: 'cs_1' } }, false],
    [2500, null, { airport: 'GSP', checkout_deposit: 'cs_1' }, true],
    [0, null, { purpose: 'airport', airport: 'GSP', depositCents: 2500 }, false],
    [null, null, { purpose: 'airport', depositCents: 1800 }, true],
    [null, null, { purpose: 'campus', depositCents: 1800 }, false],
    [2500, null, { purpose: 'campus' }, false],
    [2500, null, { airport: false }, false],
    [2500, null, { airport: '' }, false],
  ]
  for (const [deposit, note, meta, unpaid] of cases) {
    const { rows } = await db.query(
      'SELECT public.trip_airport_deposit_unpaid($1::numeric, $2, $3::jsonb) AS unpaid',
      [deposit, note, JSON.stringify(meta)],
    )
    assert.equal(rows[0].unpaid, unpaid, JSON.stringify({ deposit, note, meta }))
  }
})

test('forged trips.update cannot accept or claim an unpaid airport deposit', async () => {
  const id = await seed()
  await rejectsWith(() => claim(id), /Airport deposit still unpaid/)
  const row = await tripOf(id)
  assert.equal(row.status, 'searching')
  assert.equal(row.driver_id, null)

  await rejectsWith(() => claim(id, 'offered'), /Airport deposit still unpaid/)
  assert.equal((await tripOf(id)).status, 'searching')

  const pinned = await seed()
  await rejectsWith(
    () => db.query('UPDATE public.trips SET driver_id = $2::uuid WHERE id = $1::uuid', [pinned, DRIVER]),
    /Airport deposit still unpaid/,
  )
  assert.equal((await tripOf(pinned)).driver_id, null)

  const requested = await seed({ status: 'requested', driver_id: DRIVER })
  await rejectsWith(
    () => db.query(`UPDATE public.trips SET status = 'accepted' WHERE id = $1::uuid`, [requested]),
    /Airport deposit still unpaid/,
  )
  assert.equal((await tripOf(requested)).status, 'requested')
})

test('a forged checkout_deposit or zeroed deposit on the same update does not count as paid', async () => {
  const stamped = await seed()
  await rejectsWith(
    () => db.query(
      `UPDATE public.trips
       SET status = 'accepted',
           driver_id = $2::uuid,
           metadata = coalesce(metadata, '{}'::jsonb) || '{"checkout_deposit":{"session_id":"forged"}}'::jsonb
       WHERE id = $1::uuid`,
      [stamped, DRIVER],
    ),
    /Airport deposit still unpaid/,
  )
  assert.equal((await tripOf(stamped)).status, 'searching')
  assert.equal((await tripOf(stamped)).metadata.checkout_deposit, undefined)

  const zeroed = await seed()
  await rejectsWith(
    () => db.query(
      `UPDATE public.trips
       SET status = 'accepted', driver_id = $2::uuid, deposit_cents = 0
       WHERE id = $1::uuid`,
      [zeroed, DRIVER],
    ),
    /Airport deposit still unpaid/,
  )
  assert.equal((await tripOf(zeroed)).deposit_cents, 2500)
})

test('paid deposits, zero deposits, and non-airport trips still accept', async () => {
  const byFare = await seed({
    metadata: { purpose: 'airport', airport: 'GSP', fare_paid_cents: 2500 },
  })
  await claim(byFare)
  assert.equal((await tripOf(byFare)).status, 'accepted')
  assert.equal((await tripOf(byFare)).driver_id, DRIVER)

  const byStamp = await seed({
    metadata: {
      purpose: 'airport',
      airport: 'CLT',
      checkout_deposit: { session_id: 'cs_1', at: '2026-09-24T14:00:00.000Z' },
    },
  })
  await claim(byStamp)
  assert.equal((await tripOf(byStamp)).status, 'accepted')

  const credits = await seed({
    deposit_cents: 0,
    metadata: { kind: 'airport', purpose: 'airport', airport: 'GSP' },
  })
  await claim(credits)
  assert.equal((await tripOf(credits)).status, 'accepted')

  const campus = await seed({
    deposit_cents: 2500,
    metadata: { purpose: 'campus' },
  })
  await claim(campus)
  assert.equal((await tripOf(campus)).status, 'accepted')
})

test('cancel, payment stamp, and restore stay allowed, then a paid accept works', async () => {
  const id = await seed({ status: 'scheduled', pickup_at: '2026-10-01T15:00:00.000Z' })
  await db.query(
    `UPDATE public.trips
     SET status = 'canceled',
         canceled_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || '{"checkout_abandoned":{"reason":"unpaid_checkout"}}'::jsonb
     WHERE id = $1::uuid`,
    [id],
  )
  assert.equal((await tripOf(id)).status, 'canceled')

  await rejectsWith(
    () => db.query(`SELECT public.accept_scheduled_trip($1::uuid)`, [id]),
    /no longer available/,
  )
  await rejectsWith(() => claim(id), /Airport deposit still unpaid/)
  assert.equal((await tripOf(id)).status, 'canceled')

  await db.query(
    `UPDATE public.trips
     SET status = 'scheduled',
         canceled_at = NULL,
         metadata = (coalesce(metadata, '{}'::jsonb) - 'checkout_abandoned')
           || '{"checkout_deposit":{"session_id":"cs_paid"}}'::jsonb
     WHERE id = $1::uuid`,
    [id],
  )
  const restored = await tripOf(id)
  assert.equal(restored.status, 'scheduled')
  assert.equal(restored.metadata.checkout_deposit.session_id, 'cs_paid')

  const accepted = await db.query(`SELECT public.accept_scheduled_trip($1::uuid) AS row`, [id])
  assert.equal(accepted.rows[0].row.status, 'accepted')
  assert.equal(accepted.rows[0].row.driver_id, DRIVER)
  const events = await db.query('SELECT kind FROM public.trip_events WHERE trip_id = $1::uuid', [id])
  assert.equal(events.rows[0].kind, 'accepted')
})

test('accept_scheduled_trip rejects an unpaid airport deposit and keeps the row', async () => {
  const id = await seed({
    status: 'scheduled',
    pickup_at: '2026-10-02T15:00:00.000Z',
    rider_note: 'airport',
    metadata: { kind: 'scheduled', airport: 'CLT' },
  })
  await rejectsWith(
    () => db.query(`SELECT public.accept_scheduled_trip($1::uuid)`, [id]),
    /Airport deposit still unpaid/,
  )
  const row = await tripOf(id)
  assert.equal(row.status, 'scheduled')
  assert.equal(row.driver_id, null)

  const paid = await seed({
    status: 'scheduled',
    pickup_at: '2026-10-02T18:00:00.000Z',
    metadata: { kind: 'scheduled', airport: 'CLT', fare_paid_cents: 2500 },
  })
  await db.query(`SELECT public.accept_scheduled_trip($1::uuid)`, [paid])
  assert.equal((await tripOf(paid)).status, 'accepted')
  await rejectsWith(
    () => db.query(`SELECT public.accept_scheduled_trip($1::uuid)`, [paid]),
    /no longer available/,
  )
})

test('webhook metadata stamp is not an accept, and later progress of an already accepted trip is unchanged', async () => {
  const id = await seed()
  await db.query(
    `UPDATE public.trips
     SET metadata = coalesce(metadata, '{}'::jsonb) || '{"fare_paid_cents":2500}'::jsonb
     WHERE id = $1::uuid`,
    [id],
  )
  assert.equal((await tripOf(id)).status, 'searching')
  await claim(id)
  await db.query(`UPDATE public.trips SET status = 'arriving' WHERE id = $1::uuid`, [id])
  assert.equal((await tripOf(id)).status, 'arriving')

  const legacy = await seed({ status: 'accepted', driver_id: DRIVER })
  await db.query(`UPDATE public.trips SET status = 'arriving' WHERE id = $1::uuid`, [legacy])
  assert.equal((await tripOf(legacy)).status, 'arriving')
})
