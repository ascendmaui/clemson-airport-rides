import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { driverVehicleStandardIssue } from '../shared/vehicleStandards.js'
import {
  DRIVER_RENTALS_BROWSE_URL,
  LUXURY_EXCEPTION_MESSAGE,
  LUXURY_PHOTOS_MESSAGE,
  OWN_OR_LEASE_LABEL,
  POOR_CONDITION_MESSAGE,
  RENT_FROM_PARTNER_LABEL,
  assessOwnedVehicle,
  isPreStandardYear,
} from '../shared/ownedVehicle.js'

const migrationName = '20261013103000_vehicle_luxury_exception.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
const now = new Date('2026-10-13T12:00:00Z')
const oldId = '11111111-1111-4111-8111-111111111111'
const nextId = '22222222-2222-4222-8222-222222222222'

test('owned vehicle accepts 2019 or newer and blocks poor condition', () => {
  assert.equal(assessOwnedVehicle({ year: 2019, condition: 'good' }, now).ok, true)
  assert.equal(assessOwnedVehicle({ year: 2019, condition: 'good' }, now).luxuryException, false)
  assert.equal(assessOwnedVehicle({ year: '2024', condition: 'excellent' }, now).luxuryException, false)
  assert.equal(assessOwnedVehicle({ year: 2018, condition: 'fair' }, now).ok, false)
  assert.equal(isPreStandardYear(2018, now), true)
  assert.equal(isPreStandardYear(2019, now), false)

  const poorNew = assessOwnedVehicle({ year: 2022, condition: 'poor' }, now)
  const poorOld = assessOwnedVehicle({ year: 2010, condition: 'poor', luxuryPhotos: ['a.jpg'] }, now)
  assert.equal(poorNew.ok, false)
  assert.equal(poorNew.message, POOR_CONDITION_MESSAGE)
  assert.equal(poorOld.message, POOR_CONDITION_MESSAGE)
  assert.match(POOR_CONDITION_MESSAGE, /Poor condition is blocked/)
})

test('older cars require luxury photos and stay pending for approveLuxuryException', () => {
  const missing = assessOwnedVehicle({ year: 2018, condition: 'excellent', luxuryPhotos: [] }, now)
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'luxury_photos')
  assert.equal(missing.message, LUXURY_PHOTOS_MESSAGE)

  const ready = assessOwnedVehicle({ year: 2015, condition: 'good', luxuryPhotos: [' file://front.jpg '] }, now)
  assert.equal(ready.ok, true)
  assert.equal(ready.luxuryException, true)
  assert.equal(ready.year, 2015)
  assert.equal(ready.message, LUXURY_EXCEPTION_MESSAGE)
  assert.equal(driverVehicleStandardIssue({ year: ready.year }).code, 'vehicle_luxury_review')
  assert.equal(driverVehicleStandardIssue({ year: ready.year }, { luxuryApproved: true }), null)

  const admin = readFileSync(new URL('../src/screens/AdminDrivers.jsx', import.meta.url), 'utf8')
  const api = readFileSync(new URL('../api/admin-drivers.js', import.meta.url), 'utf8')
  assert.match(admin, /approveLuxuryException/)
  assert.match(api, /approveLuxuryException/)
})

test('add vehicle offers own-or-lease and rent, and rent opens the driver browse', () => {
  assert.equal(OWN_OR_LEASE_LABEL, 'I own or lease this car')
  assert.equal(RENT_FROM_PARTNER_LABEL, 'Rent from a partner')
  assert.equal(DRIVER_RENTALS_BROWSE_URL, 'https://clemsonrides.com/#/rentals')
  const screen = readFileSync(new URL('../apps/driver/app/vehicles.tsx', import.meta.url), 'utf8')
  const rentals = readFileSync(new URL('../src/screens/RentalPartners.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(screen, /OWN_OR_LEASE_LABEL/)
  assert.match(screen, /RENT_FROM_PARTNER_LABEL/)
  assert.match(screen, /DRIVER_RENTALS_BROWSE_URL/)
  assert.match(screen, /Linking\.openURL\(DRIVER_RENTALS_BROWSE_URL\)/)
  assert.match(screen, /assessOwnedVehicle/)
  assert.match(screen, /label="Year"/)
  assert.match(screen, /Condition/)
  assert.match(rentals, /export function DriverRentals/)
  assert.match(app, /case 'rentals':/)
})

test('luxury exception migration is additive, unique, and NOT VALID', async () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql'))
  const versions = names.map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013103000').length, 1)
  assert.equal(names.includes(migrationName), true)
  assert.match(migration, /add column if not exists luxury_exception boolean/i)
  assert.match(migration, /check \(year is null or year >= 2019 or luxury_exception\)/i)
  assert.match(migration, /not valid/i)
  assert.doesNotMatch(migration, /drop table|delete from|truncate/i)
  assert.doesNotMatch(migration, /luxury_exception boolean not null/i)

  const db = new PGlite()
  try {
    await db.exec(`
      create table vehicles (
        id uuid primary key,
        driver_id uuid,
        year integer,
        make text
      );
    `)
    await db.query('insert into vehicles (id, year, make) values ($1, $2, $3)', [oldId, 2010, 'Legacy'])
    await db.exec(migration)
    await db.exec(migration)

    const columns = (await db.query(`
      select is_nullable
      from information_schema.columns
      where table_name = 'vehicles' and column_name = 'luxury_exception'
    `)).rows
    assert.equal(columns.length, 1)
    assert.equal(columns[0].is_nullable, 'YES')
    const constraint = (await db.query(`
      select convalidated
      from pg_constraint
      where conname = 'vehicles_year_luxury_exception_check'
    `)).rows
    assert.equal(constraint.length, 1)
    assert.equal(constraint[0].convalidated, false)

    const kept = (await db.query('select year, luxury_exception, make from vehicles where id = $1', [oldId])).rows[0]
    assert.equal(kept.year, 2010)
    assert.equal(kept.luxury_exception, null)
    assert.equal(kept.make, 'Legacy')

    await assert.rejects(
      () => db.query('insert into vehicles (id, year, luxury_exception) values ($1, $2, $3)', [nextId, 2018, false]),
      /vehicles_year_luxury_exception_check/,
    )
    await db.query('insert into vehicles (id, year, luxury_exception, make) values ($1, $2, $3, $4)', [nextId, 2015, true, 'Town Car'])
    await db.query(
      'insert into vehicles (id, year, luxury_exception) values ($1, $2, $3)',
      ['33333333-3333-4333-8333-333333333333', 2019, null],
    )
    await db.query(
      'insert into vehicles (id, year, luxury_exception) values ($1, $2, $3)',
      ['44444444-4444-4444-8444-444444444444', null, null],
    )
    const saved = (await db.query('select year, luxury_exception from vehicles where id = $1', [nextId])).rows[0]
    assert.equal(saved.year, 2015)
    assert.equal(saved.luxury_exception, true)

    const empty = new PGlite()
    try {
      await empty.exec(migration)
    } finally {
      await empty.close()
    }
  } finally {
    await db.close()
  }
})
