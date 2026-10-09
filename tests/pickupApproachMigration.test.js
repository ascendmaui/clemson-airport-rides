import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261004161000_pickup_approach_sync.sql', import.meta.url), 'utf8')
test('GPS advances only assigned accepted trips near pickup, without starting wait time', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create type trip_status as enum ('accepted','arriving','arrived','in_progress','completed','canceled','searching');
      create table trips (id text primary key, driver_id text, status trip_status, pickup_lat double precision, pickup_lng double precision, arrived_at timestamptz);
      create table driver_status (driver_id text primary key, lat double precision, lng double precision, location_updated_at timestamptz, online boolean);
    `)
    await db.exec(migration)
    await db.exec(migration)
    const reset = async (status = 'accepted', driver = 'd', lat = 34.68) => {
      await db.exec('truncate trips, driver_status')
      await db.query('insert into trips values ($1,$2,$3,$4,-82.83,null)', ['t', driver, status, lat])
    }
    const fix = async (lat = 34.681, age = '0 seconds') => db.query(`
      insert into driver_status values ('d',$1,-82.83,clock_timestamp() - $2::interval,true)
      on conflict (driver_id) do update set lat = excluded.lat, location_updated_at = excluded.location_updated_at
    `, [lat, age])
    const row = async () => (await db.query('select * from trips')).rows[0]
    await reset()
    await fix(34.70)
    assert.equal((await row()).status, 'accepted')
    await fix()
    assert.equal((await row()).status, 'arriving')
    assert.equal((await row()).arrived_at, null)
    await fix(34.70)
    assert.equal((await row()).status, 'arriving')
    for (const status of ['arrived','in_progress','completed','canceled','searching']) {
      await reset(status)
      await fix()
      assert.equal((await row()).status, status)
    }
    for (const age of ['31 seconds', '-31 seconds']) {
      await reset()
      await fix(34.681, age)
      assert.equal((await row()).status, 'accepted')
    }
    for (const lat of [null, 91, NaN]) {
      await reset()
      await fix(lat)
      assert.equal((await row()).status, 'accepted')
    }
    await reset('accepted', 'someone-else')
    await fix()
    assert.equal((await row()).status, 'accepted')
    await reset('accepted', 'd', null)
    await fix()
    assert.equal((await row()).status, 'accepted')
    await reset()
    await fix(34.70)
    await fix(34.681, '5 seconds')
    assert.equal((await row()).status, 'accepted', 'older fix must not advance status')
    await db.exec('update driver_status set online = false')
    assert.equal((await row()).status, 'accepted', 'presence does not trigger approach')
  } finally { await db.close() }
})
