import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { noticeIsCurrent, sweepTripStatusNotices, tripStatusNoticeCopy } from './tripStatusNotices.js'
import { tipLine, tripEndSummary } from '../packages/rides-native/tripEndSummary.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tokensSql = read('../supabase/migrations/20261009030000_driver_push_tokens.sql')
const noticesSql = read('../supabase/migrations/20261010090000_trip_status_notices.sql')
const tipSql = read('../supabase/migrations/20261010140000_driver_tip_notice.sql')
const rider = '00000000-0000-0000-0000-00000000000a'
const driver = '00000000-0000-0000-0000-00000000000b'

async function setup() {
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
      pickup_at timestamptz, scheduled_for timestamptz, tip_cents integer not null default 0);
    insert into auth.users values ('${rider}'), ('${driver}');
  `)
  await db.exec(tokensSql)
  await db.exec(noticesSql)
  await db.exec(tipSql)
  return db
}

test('a tip on a completed trip queues one driver_tipped notice and pokes the drain', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const { rows: [{ id }] } = await db.query(`insert into trips (rider_id, driver_id, status) values ($1, $2, 'completed') returning id`, [rider, driver])
  await db.query('update trips set tip_cents = 300 where id = $1', [id])
  await db.query('update trips set tip_cents = 300 where id = $1', [id])
  await db.query('update trips set tip_cents = 500 where id = $1', [id])
  const rows = (await db.query(`select kind, recipient_id, recipient_role, driver_id, dedupe_key from trip_status_notices`)).rows
  assert.deepEqual(rows.map((r) => [r.kind, r.recipient_role, r.recipient_id]), [['driver_tipped', 'driver', driver]])
  assert.equal(rows[0].dedupe_key, `driver_tipped:${id}:${driver}`)
  const pokes = (await db.query('select url from net.calls')).rows
  assert.equal(pokes.length, 1)
  assert.match(pokes[0].url, /only=trip-status-notices/)
})

test('no tip notice for unassigned or unfinished trips, or a tip going down', async (t) => {
  const db = await setup()
  t.after(() => db.close())
  const { rows: [{ id: a }] } = await db.query(`insert into trips (rider_id, status) values ($1, 'completed') returning id`, [rider])
  const { rows: [{ id: b }] } = await db.query(`insert into trips (rider_id, driver_id, status) values ($1, $2, 'in_progress') returning id`, [rider, driver])
  const { rows: [{ id: c }] } = await db.query(`insert into trips (rider_id, driver_id, status, tip_cents) values ($1, $2, 'completed', 400) returning id`, [rider, driver])
  await db.query('update trips set tip_cents = 300 where id = $1', [a])
  await db.query('update trips set tip_cents = 300 where id = $1', [b])
  await db.query('update trips set tip_cents = 0 where id = $1', [c])
  assert.equal((await db.query('select count(*)::int as n from trip_status_notices')).rows[0].n, 0)
})

test('the migration is private and reversible', () => {
  assert.match(tipSql, /security definer/)
  assert.match(tipSql, /revoke all on function public\.enqueue_trip_tip_notice\(\) from public/)
  assert.match(tipSql, /after update of tip_cents on public\.trips/)
  assert.match(tipSql, /-- Down \(reversible\)/)
})

test('tip push copy names the rider and the amount', () => {
  assert.deepEqual(tripStatusNoticeCopy('driver_tipped', { riderName: 'Riley Jones', tipCents: 300 }), {
    title: 'Riley tipped you $3', body: 'It shows in Other on your Earnings tab.',
  })
  assert.equal(tripStatusNoticeCopy('driver_tipped', { riderName: '', tipCents: 450 }).title, 'Your rider tipped you $4.50')
  assert.equal(tripStatusNoticeCopy('driver_tipped', { riderName: 'Riley', tipCents: 0 }), null)
  const notice = { kind: 'driver_tipped', recipient_id: driver, driver_id: driver }
  assert.equal(noticeIsCurrent(notice, { status: 'completed', driver_id: driver, rider_id: rider }), true)
  assert.equal(noticeIsCurrent(notice, { status: 'completed', driver_id: 'other', rider_id: rider }), false)
})

test('the drain sends the tip push to a driver build with status pushes', async () => {
  const sent = []
  const trip = { id: 't1', status: 'completed', rider_id: rider, driver_id: driver, metadata: { rider_first_name: 'Riley' }, tip_cents: 300 }
  const row = { id: 1, trip_id: 't1', kind: 'driver_tipped', recipient_id: driver, recipient_role: 'driver', driver_id: driver, created_at: new Date().toISOString(), claimed_at: null, attempts: 0 }
  const table = (name) => {
    const q = {
      _name: name,
      select() { return q }, is() { return q }, gte() { return q }, order() { return q }, limit() { return Promise.resolve({ data: name === 'trip_status_notices' ? [row] : [], error: null }) },
      update() { return { eq() { return { is() { const c = { is: () => c, eq: () => c, select: async () => ({ data: [{ id: 1 }], error: null }) }; return c }, then: (r) => r({ error: null }) } } } },
      eq() { return q },
      maybeSingle: async () => {
        if (name === 'trips') return { data: trip, error: null }
        if (name === 'driver_push_tokens') return { data: { token: 'ExponentPushToken[x]', features: ['trip_status_v1'] }, error: null }
        return { data: null, error: null }
      },
      delete() { return { lt: async () => ({}) } },
    }
    return q
  }
  const out = await sweepTripStatusNotices({ from: table }, { sendPush: async (msg) => { sent.push(msg); return { sent: true } } })
  assert.equal(out.sent, 1)
  assert.equal(sent[0].title, 'Riley tipped you $3')
  assert.equal(sent[0].data.kind, 'driver_tipped')
})

test('trip-end summary leads with the tip once it arrives', () => {
  assert.equal(tipLine('Riley', 300), 'Riley tipped you $3')
  assert.equal(tipLine('Rider', 325), 'Your rider tipped you $3.25')
  assert.equal(tipLine('Riley', 0), null)
  const none = tripEndSummary({ status: 'completed', fareCents: 2000, driverNetCents: 1600, tipCents: 0, firstName: 'Riley' })
  assert.equal(none.tip.headline, null)
  assert.match(none.tip.note, /notification/)
  assert.match(none.accessibilityLabel, /No tip yet/)
  const tipped = tripEndSummary({ status: 'completed', fareCents: 2000, driverNetCents: 1600, tipCents: 300, firstName: 'Riley' })
  assert.equal(tipped.tip.headline, 'Riley tipped you $3')
  assert.equal(tipped.tip.value, '+$3.00')
  assert.equal(tipped.net.cents, 1600)
  assert.match(tipped.accessibilityLabel, /Riley tipped you \$3/)
  assert.match(read('../apps/driver/components/TripEndSummary.tsx'), /summary\.tip\.headline \?/)
})
