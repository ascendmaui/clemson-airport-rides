import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { NOTICE_KINDS, noticeIsCurrent, sweepTripStatusNotices, tripStatusNoticeCopy } from './tripStatusNotices.js'
import { driverCanceledView, nextDriverTripCard, releasedTripCard, MISSING_TRIP_VIEW } from '../packages/rides-native/tripCanceled.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const baseSql = read('../supabase/migrations/20261010090000_trip_status_notices.sql')
const cancelSql = read('../supabase/migrations/20261010110000_trip_cancel_notices.sql')
const tokensSql = read('../supabase/migrations/20261009030000_driver_push_tokens.sql')
const rider = '00000000-0000-0000-0000-00000000000a'
const driver = '00000000-0000-0000-0000-00000000000b'
const driver2 = '00000000-0000-0000-0000-00000000000c'

async function setup({ metadata = true } = {}) {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    insert into vault.decrypted_secrets values ('clemson_cron_secret', 'cron-secret');
    create schema net;
    create table net.calls (id bigserial primary key, url text, headers jsonb);
    create function net.http_get(url text, headers jsonb, timeout_milliseconds int) returns bigint language plpgsql as $$
    declare v bigint; begin insert into net.calls (url, headers) values (url, headers) returning id into v; return v; end $$;
    create type public.trip_status as enum ('searching','offered','accepted','arriving','in_progress','completed','canceled','scheduled','canceled_midride','arrived','cancelled_wait');
    create table public.trips (id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid, status public.trip_status,
      pickup_at timestamptz, scheduled_for timestamptz ${metadata ? ", metadata jsonb not null default '{}'" : ''});
    insert into auth.users values ('${rider}'), ('${driver}'), ('${driver2}');
  `)
  await db.exec(tokensSql)
  await db.exec(baseSql)
  await db.exec(cancelSql)
  return db
}

const notices = async (db) => (await db.query('select kind, recipient_id, recipient_role, driver_id from trip_status_notices order by id')).rows
const live = async (db, status = 'arriving', who = driver) =>
  (await db.query(`insert into trips (rider_id, driver_id, status) values ($1, $2, $3) returning id`, [rider, who, status])).rows[0].id

test('rider cancel during pickup notifies the driver who held the trip', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const id = await live(db, 'arrived')
  await db.query(`update trips set status='canceled' where id=$1`, [id])
  assert.deepEqual(await notices(db), [{ kind: 'rider_canceled', recipient_id: driver, recipient_role: 'driver', driver_id: driver }])
})

test('rider switch away notifies the old driver; driver cancel tells the rider', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const switched = await live(db, 'accepted')
  await db.query(`update trips set status='searching', driver_id=null, metadata=jsonb_build_object('rider_switch', jsonb_build_object('action','switch-driver')) where id=$1`, [switched])
  const dropped = await live(db, 'arriving', driver2)
  await db.query(`update trips set status='searching', driver_id=null where id=$1`, [dropped])
  const ended = await live(db, 'accepted')
  await db.query(`update trips set status='canceled', driver_id=null, metadata='{"rider_switch":{"action":"cancel"}}' where id=$1`, [ended])
  const rows = (await notices(db)).filter((n) => n.kind !== 'driver_arriving' && n.kind !== 'arrive_prompt')
  assert.deepEqual(rows.map((n) => [n.kind, n.recipient_role, n.recipient_id]), [
    ['rider_canceled', 'driver', driver],
    ['driver_canceled', 'rider', rider],
    ['rider_canceled', 'driver', driver],
  ])
})

test('early end and no-show notify both sides as designed; repeats dedupe', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const early = await live(db, 'in_progress')
  await db.query(`update trips set status='canceled_midride' where id=$1`, [early])
  const wait = await live(db, 'arrived')
  await db.query(`update trips set status='cancelled_wait' where id=$1`, [wait])
  await db.query(`update trips set status='arrived' where id=$1`, [wait])
  await db.query(`update trips set status='cancelled_wait' where id=$1`, [wait])
  const rows = (await notices(db)).filter((n) => n.kind !== 'driver_arrived')
  assert.deepEqual(rows.map((n) => [n.kind, n.recipient_role]), [
    ['rider_ended_early', 'driver'],
    ['rider_no_show', 'driver'],
    ['wait_canceled', 'rider'],
  ])
})

test('canceling a trip nobody accepted, or completing one, enqueues nothing', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, status) values ($1, 'searching') returning id`, [rider])
  await db.query(`update trips set status='canceled' where id=$1`, [id])
  const done = await live(db, 'in_progress')
  await db.query(`update trips set status='completed' where id=$1`, [done])
  assert.deepEqual(await notices(db), [])
})

test('the trigger never blocks a status write, even on a table without metadata', async (t) => {
  const db = await setup({ metadata: false })
  t.after(() => db.close())
  const id = await live(db, 'accepted')
  await db.query(`update trips set status='canceled' where id=$1`, [id])
  const { rows } = await db.query(`select status from trips where id=$1`, [id])
  assert.equal(rows[0].status, 'canceled')
  assert.deepEqual((await notices(db)).map((n) => n.kind), ['rider_canceled'])
})

test('released notices stay current after the driver is gone; live ones do not', () => {
  const n = (kind, extra = {}) => ({ kind, recipient_id: driver, driver_id: driver, ...extra })
  assert.equal(noticeIsCurrent(n('rider_canceled'), { status: 'canceled', driver_id: driver, rider_id: rider }), true)
  assert.equal(noticeIsCurrent(n('rider_canceled'), { status: 'searching', driver_id: null, rider_id: rider }), true)
  assert.equal(noticeIsCurrent(n('rider_canceled'), { status: 'accepted', driver_id: driver2, rider_id: rider }), true)
  assert.equal(noticeIsCurrent(n('rider_canceled'), { status: 'accepted', driver_id: driver, rider_id: rider }), false)
  const toRider = { kind: 'driver_canceled', recipient_id: rider, driver_id: driver }
  assert.equal(noticeIsCurrent(toRider, { status: 'searching', driver_id: null, rider_id: rider }), true)
  assert.equal(noticeIsCurrent(toRider, { status: 'canceled', driver_id: null, rider_id: rider }), false)
  assert.equal(noticeIsCurrent(toRider, { status: 'accepted', driver_id: driver, rider_id: rider }), false)
  assert.equal(noticeIsCurrent(n('rider_ended_early'), { status: 'canceled_midride', driver_id: driver, rider_id: rider }), true)
  assert.equal(noticeIsCurrent(n('rider_no_show'), { status: 'completed', driver_id: driver, rider_id: rider }), false)
  assert.equal(NOTICE_KINDS.wait_canceled.role, 'rider')
})

test('cancel copy for both sides', () => {
  assert.deepEqual(tripStatusNoticeCopy('rider_canceled', { riderName: 'Avery Lee' }), {
    title: 'Ride canceled', body: "Avery canceled this ride. You're free for the next offer.",
  })
  assert.match(tripStatusNoticeCopy('rider_canceled', { switched: true }).body, /^The rider changed their ride/)
  assert.equal(tripStatusNoticeCopy('rider_no_show', { driverWaitCents: 400 }).body, 'The ride was canceled after the wait. You earn $4.00.')
  assert.equal(tripStatusNoticeCopy('driver_canceled', { pickupLabel: 'Cooper Library' }).body, "We're finding you another driver for Cooper Library.")
  assert.equal(tripStatusNoticeCopy('wait_canceled', { pickupLabel: 'Fike', riderFeeCents: 500 }).body, 'Your driver waited at Fike. A $5.00 no-show fee applies.')
  assert.equal(tripStatusNoticeCopy('rider_ended_early', { riderName: 'Sam' }).title, 'Trip ended early')
})

function fakeDb({ notice, trip, profiles = {}, tokens = {} }) {
  const updates = []
  const pushes = []
  const sb = {
    from(table) {
      const q = {
        _table: table,
        _filters: {},
        select() { return q },
        is() { return q },
        gte() { return q },
        order() { return q },
        lt() { return q },
        limit() { return table === 'trip_status_notices' ? Promise.resolve({ data: [notice], error: null }) : Promise.resolve({ data: [], error: null }) },
        eq(col, val) { q._filters[col] = val; return q },
        update(values) { updates.push({ table, values }); return q },
        delete() { return q },
        then(resolve) { return resolve({ data: [{ id: notice.id }], error: null }) },
        maybeSingle: async () => {
          if (table === 'trips') return { data: trip, error: null }
          if (table === 'profiles') return { data: profiles[q._filters.id] || null, error: null }
          if (table === 'driver_push_tokens') return { data: tokens[q._filters.driver_id] || null, error: null }
          if (table === 'rider_push_tokens') return { data: tokens[q._filters.rider_id] || null, error: null }
          return { data: null, error: null }
        },
      }
      return q
    },
  }
  return { sb, updates, pushes, sendPush: async (msg) => { pushes.push(msg); return { sent: true } } }
}

test('sweep sends rider_canceled to a status-capable driver build after the trip left them', async () => {
  const fake = fakeDb({
    notice: { id: 7, trip_id: 't1', kind: 'rider_canceled', recipient_id: driver, recipient_role: 'driver', driver_id: driver, created_at: new Date().toISOString(), claimed_at: null, attempts: 0 },
    trip: { id: 't1', status: 'searching', rider_id: rider, driver_id: null, pickup_label: 'Cooper Library', metadata: { rider_first_name: 'Avery', rider_switch: { action: 'switch-driver' } } },
    tokens: { [driver]: { token: 'ExponentPushToken[d]', features: ['trip_status_v1'] } },
  })
  const result = await sweepTripStatusNotices(fake.sb, { sendPush: fake.sendPush })
  assert.equal(result.sent, 1)
  assert.equal(fake.pushes[0].title, 'Ride canceled')
  assert.equal(fake.pushes[0].body, "Avery changed their ride. You're free for the next offer.")
  assert.deepEqual(fake.pushes[0].data, { tripId: 't1', kind: 'rider_canceled', status: 'searching' })
  assert.equal(fake.pushes[0].channelId, 'ride-requests')
})

test('old driver builds (no trip_status_v1) never get cancel pushes', async () => {
  const fake = fakeDb({
    notice: { id: 8, trip_id: 't1', kind: 'rider_canceled', recipient_id: driver, recipient_role: 'driver', driver_id: driver, created_at: new Date().toISOString(), claimed_at: null, attempts: 0 },
    trip: { id: 't1', status: 'canceled', rider_id: rider, driver_id: driver, pickup_label: 'Fike', metadata: {} },
    tokens: { [driver]: { token: 'ExponentPushToken[old]', features: [] } },
  })
  const result = await sweepTripStatusNotices(fake.sb, { sendPush: fake.sendPush })
  assert.equal(result.sent, 0)
  assert.equal(fake.pushes.length, 0)
})

test('driver screen: canceled, released, and missing trips get a way back to the queue', () => {
  const card = { id: 't1', status: 'arriving', firstName: 'Avery' }
  assert.deepEqual(nextDriverTripCard(card, null), { ...card, status: 'canceled', released: true })
  assert.equal(nextDriverTripCard({ ...card, status: 'completed' }, null), null)
  assert.equal(nextDriverTripCard(null, null), null)
  const released = releasedTripCard(card)
  assert.equal(nextDriverTripCard(released, null), released)
  assert.equal(driverCanceledView(released).action, 'Back to queue')
  assert.equal(driverCanceledView({ status: 'canceled', firstName: 'Avery' }).body, "Avery canceled this ride. You're free for the next offer.")
  assert.equal(driverCanceledView({ status: 'canceled_midride' }).title, 'Trip ended early')
  assert.equal(driverCanceledView({ status: 'arrived' }), null)
  assert.equal(MISSING_TRIP_VIEW.action, 'Back to queue')
  const screen = read('../apps/driver/app/trip.tsx')
  assert.match(screen, /nextDriverTripCard\(current, row\)/)
  assert.match(screen, /<Primary label=\{canceledView\.action\} onPress=\{\(\) => router\.replace\('\/'\)\}/)
  assert.match(screen, /MISSING_TRIP_VIEW\.title/)
  const push = read('../apps/driver/lib/push.ts')
  assert.match(push, /if \(isTripStatusPush\(data\)\)/)
})
