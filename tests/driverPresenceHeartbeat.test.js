import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createPresenceHeartbeat } from '../packages/rides-native/presenceHeartbeat.js'
import { publishDriverLocation } from '../packages/rides-native/driverDesk.js'
import { setDriverOnline } from '../packages/rides-native/drivers.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const D = '00000000-0000-0000-0000-00000000000d'
const fix = { lat: 34.67, lng: -82.83, heading: null }

function harness() {
  const starts = []
  const writes = []
  let pending = []
  const presence = createPresenceHeartbeat({
    startPublisher(onFix) {
      const publisher = { onFix, stopped: false }
      starts.push(publisher)
      return () => { publisher.stopped = true }
    },
    // Writes resolve when the test says so, to model a request in flight during END.
    write: (id, payload, guards) => new Promise((resolve) => {
      pending.push(() => {
        if (guards.isCurrent()) {
          const online = payload.online && guards.onlineIsCurrent() ? true : undefined
          writes.push({ id, online, tripId: payload.tripId })
        }
        resolve()
      })
    }),
  })
  const flush = () => { const run = pending; pending = []; run.forEach((fn) => fn()) }
  const live = () => starts.filter((p) => !p.stopped)
  return { presence, starts, writes, flush, live }
}

test('two Home screens share one heartbeat, and END stops it for good', async () => {
  const h = harness()
  // Home A and Home B (deep-link sign-in) both configure the same singleton.
  for (let i = 0; i < 2; i += 1) {
    h.presence.setDriver(D)
    h.presence.adoptServerOnline(true)
  }
  assert.equal(h.starts.length, 1)
  void h.live()[0].onFix(fix)
  h.flush()
  assert.deepEqual(h.writes, [{ id: D, online: true, tripId: null }])

  // A fix is in flight when the driver taps END.
  const inflight = h.live()[0].onFix(fix)
  h.presence.goOffline()
  h.flush()
  await inflight
  assert.equal(h.writes.length, 1, 'an in-flight heartbeat must not write after END')
  assert.equal(h.live().length, 0)

  // Home B's stale "online" view cannot restart it.
  h.presence.adoptServerOnline(true)
  assert.equal(h.live().length, 0)
  assert.equal(h.presence.snapshot().intent, 'offline')

  // Only GO turns it back on.
  h.presence.goOnline()
  assert.equal(h.live().length, 1)
})

test('server offline always wins; trip location keeps flowing without touching online', async () => {
  const h = harness()
  h.presence.setDriver(D)
  h.presence.adoptServerOnline(true)
  h.presence.adoptServerOnline(false)
  assert.equal(h.live().length, 0)
  h.presence.setTrip({ id: 'trip-1', status: 'arriving' })
  assert.equal(h.live().length, 1)
  void h.live()[0].onFix(fix)
  h.flush()
  assert.deepEqual(h.writes, [{ id: D, online: undefined, tripId: 'trip-1' }])
  h.presence.setTrip(null)
  assert.equal(h.live().length, 0)
})

test('signing out or switching driver drops the old heartbeat', () => {
  const h = harness()
  h.presence.setDriver(D)
  h.presence.goOnline()
  h.presence.setDriver(null)
  assert.equal(h.live().length, 0)
  assert.equal(h.presence.snapshot().intent, null)
})

function fakeStatusClient({ failSource = false } = {}) {
  const upserts = []
  return {
    upserts,
    from(table) {
      const q = {
        upsert: async (row) => {
          upserts.push({ table, row: { ...row } })
          if (failSource && 'online_source' in row) return { error: { message: "Could not find the 'online_source' column" } }
          return { error: null }
        },
        select() { return q }, eq() { return q }, in() { return q }, order() { return q }, limit() { return q },
        maybeSingle: async () => ({ data: { onboarding_status: 'approved' }, error: null }),
      }
      return q
    },
  }
}

test('location writes leave online alone unless the heartbeat asks; GO and END are tagged', async () => {
  const sb = fakeStatusClient()
  await publishDriverLocation(sb, D, { ...fix, tripId: 't', tripStatus: 'arriving' })
  assert.equal('online' in sb.upserts[0].row, false)
  await publishDriverLocation(sb, D, { ...fix, online: true, onlineSource: 'heartbeat' })
  const beat = sb.upserts.filter((u) => u.table === 'driver_status').at(-1).row
  assert.equal(beat.online, true)
  assert.equal(beat.online_source, 'heartbeat')
  await setDriverOnline(sb, D, true, fix)
  assert.equal(sb.upserts.at(-1).row.online_source, 'go')
  await setDriverOnline(sb, D, false)
  assert.equal(sb.upserts.at(-1).row.online_source, 'end')
  const old = fakeStatusClient({ failSource: true })
  await setDriverOnline(old, D, true, fix)
  assert.equal('online_source' in old.upserts.at(-1).row, false, 'retries without online_source before the migration')
})

test('driver screens no longer run their own online heartbeat', () => {
  const home = read('../apps/driver/app/(tabs)/index.tsx')
  assert.doesNotMatch(home, /useDriverLocation/)
  assert.doesNotMatch(home, /online: true/)
  assert.match(home, /driverPresence\.adoptServerOnline/)
  assert.match(home, /else await goOffline\(user\.id\)/)
  const trip = read('../apps/driver/app/trip.tsx')
  assert.doesNotMatch(trip, /online: true/)
  const bg = read('../apps/driver/lib/backgroundLocation.ts')
  assert.doesNotMatch(bg, /online: true/)
  const presence = read('../apps/driver/lib/presence.ts')
  assert.match(presence, /driverPresence\.goOffline\(\)\s*\n\s*await drainLocationWrites\(\)/)
})

async function guardDb() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.driver_status (driver_id uuid primary key, online boolean default false, lat double precision, lng double precision,
      updated_at timestamptz, location_updated_at timestamptz);
  `)
  await db.exec(read('../supabase/migrations/20261010120000_driver_presence_guard.sql'))
  await db.exec(read('../supabase/migrations/20261010120000_driver_presence_guard.sql'))
  await db.query(`insert into driver_status (driver_id, online, location_updated_at) values ($1, true, now())`, [D])
  return db
}
const asDriver = (db) => db.exec(`select set_config('request.jwt.claim.sub', '${D}', false)`)
const asService = (db) => db.exec(`select set_config('request.jwt.claim.sub', '', false)`)
const heartbeat = (db, source = null) => db.query(
  `insert into driver_status (driver_id, online, lat, lng, location_updated_at, online_source) values ($1, true, 1, 2, clock_timestamp(), $2)
   on conflict (driver_id) do update set online = excluded.online, lat = excluded.lat, lng = excluded.lng,
     location_updated_at = excluded.location_updated_at, online_source = excluded.online_source`, [D, source])
const go = (db, source = null) => db.query(
  `insert into driver_status (driver_id, online, online_source) values ($1, true, $2)
   on conflict (driver_id) do update set online = excluded.online, online_source = excluded.online_source`, [D, source])
const end = (db) => db.query(`update driver_status set online = false where driver_id = $1`, [D])
const state = async (db) => (await db.query(`select online, lat, offline_at, online_source from driver_status where driver_id = $1`, [D])).rows[0]

test('server backstop: after END only GO can bring the driver back online', async (t) => {
  const db = await guardDb()
  t.after(() => db.close())
  await asDriver(db)
  await end(db)
  assert.ok((await state(db)).offline_at)

  await heartbeat(db, 'heartbeat') // new build heartbeat
  let row = await state(db)
  assert.equal(row.online, false)
  assert.equal(row.lat, 1, 'the location still updates')
  assert.equal(row.online_source, null, 'online_source never persists')

  await heartbeat(db) // TF29/30 heartbeat: bumps location_updated_at, no source
  assert.equal((await state(db)).online, false)

  await go(db) // TF29/30 GO: no location_updated_at change
  row = await state(db)
  assert.equal(row.online, true)
  assert.equal(row.offline_at, null)

  await end(db)
  await go(db, 'go') // new build GO
  assert.equal((await state(db)).online, true)

  await end(db)
  await heartbeat(db, 'go') // GO that also carries a fresh fix (prod harness)
  assert.equal((await state(db)).online, true)
})

test('server backstop: expires after the window and never blocks service writes', async (t) => {
  const db = await guardDb()
  t.after(() => db.close())
  await asDriver(db)
  await end(db)
  await db.query(`update driver_status set offline_at = now() - interval '2 hours' where driver_id = $1`, [D])
  await heartbeat(db)
  assert.equal((await state(db)).online, true)
  await end(db)
  await asService(db)
  await heartbeat(db)
  assert.equal((await state(db)).online, true)
})
