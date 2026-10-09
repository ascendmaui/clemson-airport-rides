import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  VEHICLE_YEAR_MIN,
  applicantVehicleLabel,
  loadApplicantVehicles,
  maxVehicleYear,
  missingVehicleYearColumn,
  parseVehicleYear,
  vehicleAccountErrors,
  withVehicleYear,
  withoutVehicleYear,
  writeVehicleWithYearFallback,
} from '../shared/vehicleYear.js'

const migration = readFileSync(new URL('../supabase/migrations/20261005143000_vehicle_year.sql', import.meta.url), 'utf8')

test('vehicle year accepts a four-digit model year and rejects everything else', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  assert.equal(maxVehicleYear(now), 2027)
  assert.equal(parseVehicleYear('2018', now), 2018)
  assert.equal(parseVehicleYear(' 2027 ', now), 2027)
  assert.equal(parseVehicleYear(String(VEHICLE_YEAR_MIN), now), VEHICLE_YEAR_MIN)
  assert.equal(parseVehicleYear('1979', now), null)
  assert.equal(parseVehicleYear('2028', now), null)
  assert.equal(parseVehicleYear('18', now), null)
  assert.equal(parseVehicleYear('abcd', now), null)
  assert.equal(parseVehicleYear('', now), null)
  assert.equal(parseVehicleYear(null, now), null)
})

test('account fields name the missing make, model, year, color, plate, and phone', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  const errors = vehicleAccountErrors({
    fullName: '  ',
    phone: '864',
    make: '',
    model: 'Civic',
    color: '',
    plate: ' ',
    year: '19',
  }, now)
  assert.equal(errors.fullName, 'Full name is required.')
  assert.equal(errors.phone, 'Phone must have at least 10 digits.')
  assert.equal(errors.make, 'Make is required.')
  assert.equal(errors.model, undefined)
  assert.equal(errors.color, 'Color is required.')
  assert.equal(errors.plate, 'Plate is required.')
  assert.match(errors.year, /1980 to 2027/)
  assert.deepEqual(vehicleAccountErrors({
    fullName: 'Ada Lovelace',
    phone: '(864) 555-0199',
    make: 'Honda',
    model: 'Civic',
    color: 'White',
    plate: 'ABC123',
    year: '2018',
  }, now), {})
})

test('applicant vehicle label includes year, color, make, model, and plate', () => {
  assert.equal(
    applicantVehicleLabel({ year: 2018, color: 'White', make: 'Honda', model: 'Civic', plate: 'ABC123' }),
    '2018 White Honda Civic · ABC123',
  )
  assert.equal(applicantVehicleLabel({ make: 'Honda', model: 'Civic' }), 'Honda Civic')
  assert.equal(applicantVehicleLabel(null), 'No vehicle on file')
})

test('vehicle writes keep year and retry without it when the column is missing', async () => {
  assert.deepEqual(withVehicleYear({ make: 'Honda' }, '2018'), { make: 'Honda', year: 2018 })
  assert.deepEqual(withVehicleYear({ make: 'Honda' }, 'nope'), { make: 'Honda' })
  assert.deepEqual(withoutVehicleYear({ make: 'Honda', year: 2018 }), { make: 'Honda' })
  assert.equal(missingVehicleYearColumn({ message: "Could not find the 'year' column of 'vehicles' in the schema cache" }), true)
  assert.equal(missingVehicleYearColumn({ message: 'permission denied' }), false)

  const payloads = []
  const saved = await writeVehicleWithYearFallback(async (fields) => {
    payloads.push(fields)
    if (payloads.length === 1) {
      return { data: null, error: { message: "Could not find the 'year' column of 'vehicles' in the schema cache" } }
    }
    return { data: { id: 'veh-1', ...fields }, error: null }
  }, { make: 'Honda', model: 'Civic', color: 'White', plate: 'ABC123', year: 2018 })
  assert.equal(payloads.length, 2)
  assert.equal(payloads[0].year, 2018)
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[1], 'year'), false)
  assert.equal(saved.data.plate, 'ABC123')
  assert.equal(saved.error, null)
})

test('applicant vehicle load falls back when year is not in the schema', async () => {
  const seen = []
  const sb = {
    from() {
      const state = { cols: '' }
      const api = {
        select(cols) {
          state.cols = cols
          seen.push(cols)
          return api
        },
        in() { return api },
        then(resolve, reject) {
          const error = /\byear\b/.test(state.cols)
            ? { message: 'column year does not exist' }
            : null
          return Promise.resolve({
            data: error ? null : [{ driver_id: 'user-1', make: 'Honda', model: 'Civic', color: 'White', plate: 'ABC123' }],
            error,
          }).then(resolve, reject)
        },
      }
      return api
    },
  }
  const result = await loadApplicantVehicles(sb, ['user-1'])
  assert.equal(result.error, null)
  assert.equal(result.data[0].plate, 'ABC123')
  assert.equal(seen[0].includes('year'), true)
  assert.equal(seen[1].includes('year'), false)
})

test('vehicle year migration adds the column and can run twice', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create table vehicles (
        id uuid primary key,
        driver_id uuid,
        make text,
        model text,
        color text,
        plate text
      );
    `)
    await db.exec(migration)
    await db.exec(migration)
    const columns = (await db.query(`
      select column_name from information_schema.columns
      where table_name = 'vehicles' and column_name = 'year'
    `)).rows
    assert.equal(columns.length, 1)
    await db.query(
      'insert into vehicles (id, driver_id, make, model, color, plate, year) values ($1, $1, $2, $3, $4, $5, $6)',
      ['11111111-1111-4111-8111-111111111111', 'Honda', 'Civic', 'White', 'ABC123', 2018],
    )
    const row = (await db.query('select year, plate from vehicles')).rows[0]
    assert.equal(row.year, 2018)
    assert.equal(row.plate, 'ABC123')

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

test('driver application screen collects year and the signup route persists it', () => {
  const screen = readFileSync(new URL('../src/screens/DriverOnboarding.jsx', import.meta.url), 'utf8')
  const admin = readFileSync(new URL('../src/screens/AdminDrivers.jsx', import.meta.url), 'utf8')
  const routes = readFileSync(new URL('../server/driverRoutes.js', import.meta.url), 'utf8')
  assert.match(screen, /label="Year"/)
  assert.match(screen, /id="year"/)
  assert.match(screen, /vehicleAccountErrors/)
  assert.match(screen, /className="driver-application/)
  assert.match(admin, /applicantVehicleLabel/)
  assert.match(admin, /data-applicant-vehicle/)
  assert.match(routes, /parseVehicleYear/)
  assert.match(routes, /writeVehicleWithYearFallback/)
  assert.match(routes, /Vehicle color is required/)
  const approvedAt = screen.indexOf("if (status === 'approved')")
  const accountAt = screen.indexOf("step === 'account'")
  assert.ok(approvedAt > 0 && accountAt > approvedAt)
})
