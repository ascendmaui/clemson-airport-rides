import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  REBUILT_TITLE_HELPER,
  SALVAGE_TITLE_MESSAGE,
  TITLE_STATUS_OPTIONS,
  allowedTitleStatus,
  missingTitleStatusColumn,
  normalizeTitleStatus,
  titleStatusCode,
  titleStatusError,
  titleStatusRejection,
  withTitleStatus,
  withoutTitleStatus,
  writeVehicleWithTitleFallback,
} from '../shared/vehicleTitle.js'

const migration = readFileSync(new URL('../supabase/migrations/20261012212308_vehicle_title_status.sql', import.meta.url), 'utf8')

test('title status allows clean and rebuilt and blocks salvage', () => {
  assert.deepEqual(TITLE_STATUS_OPTIONS.map((option) => option.id), ['clean', 'rebuilt', 'salvage'])
  assert.equal(normalizeTitleStatus(' Clean '), 'clean')
  assert.equal(normalizeTitleStatus('REBUILT'), 'rebuilt')
  assert.equal(normalizeTitleStatus('salvage'), 'salvage')
  assert.equal(normalizeTitleStatus('junk'), null)
  assert.equal(normalizeTitleStatus(''), null)
  assert.equal(allowedTitleStatus('clean'), 'clean')
  assert.equal(allowedTitleStatus('rebuilt'), 'rebuilt')
  assert.equal(allowedTitleStatus('salvage'), null)
  assert.equal(titleStatusError('clean'), null)
  assert.equal(titleStatusError('rebuilt'), null)
  assert.equal(titleStatusError(''), 'Select a vehicle title status.')
  assert.equal(titleStatusError('branded'), 'Select Clean, Rebuilt, or Salvage.')
  assert.equal(titleStatusError('salvage'), SALVAGE_TITLE_MESSAGE)
  assert.match(SALVAGE_TITLE_MESSAGE, /can't accept a salvage title/)
  assert.match(SALVAGE_TITLE_MESSAGE, /total loss/)
  assert.match(SALVAGE_TITLE_MESSAGE, /unlike Uber and Lyft, we accept rebuilt titles/)
  assert.equal(REBUILT_TITLE_HELPER, 'Unlike Uber and Lyft, we accept rebuilt titles.')
  assert.equal(titleStatusCode(''), 'title_status_required')
  assert.equal(titleStatusCode('nope'), 'title_status_invalid')
  assert.equal(titleStatusCode('salvage'), 'salvage_title_blocked')
  assert.equal(titleStatusCode('clean'), null)
})

test('server rejection blocks a missing or salvage title before a write', () => {
  assert.deepEqual(titleStatusRejection({}), {
    error: 'Select a vehicle title status.',
    code: 'title_status_required',
  })
  assert.deepEqual(titleStatusRejection({ title_status: 'salvage' }), {
    error: SALVAGE_TITLE_MESSAGE,
    code: 'salvage_title_blocked',
  })
  assert.equal(titleStatusRejection({ titleStatus: 'rebuilt' }), null)
  assert.deepEqual(withTitleStatus({ make: 'Honda' }, 'rebuilt'), { make: 'Honda', title_status: 'rebuilt' })
  assert.deepEqual(withTitleStatus({ make: 'Honda' }, 'salvage'), { make: 'Honda' })
  assert.deepEqual(withTitleStatus({ make: 'Honda' }, ''), { make: 'Honda' })
  assert.deepEqual(withoutTitleStatus({ make: 'Honda', title_status: 'clean' }), { make: 'Honda' })
})

test('vehicle writes keep title status and retry without it when the column is missing', async () => {
  assert.equal(
    missingTitleStatusColumn({ message: "Could not find the 'title_status' column of 'vehicles' in the schema cache" }),
    true,
  )
  assert.equal(missingTitleStatusColumn({ message: 'permission denied' }), false)

  const payloads = []
  const saved = await writeVehicleWithTitleFallback(async (fields) => {
    payloads.push(fields)
    if (payloads.length === 1) {
      return { data: null, error: { message: "Could not find the 'title_status' column of 'vehicles' in the schema cache" } }
    }
    return { data: { id: 'veh-1', ...fields }, error: null }
  }, { make: 'Honda', plate: 'ABC123', title_status: 'clean' })
  assert.equal(payloads.length, 2)
  assert.equal(payloads[0].title_status, 'clean')
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[1], 'title_status'), false)
  assert.equal(saved.data.plate, 'ABC123')
  assert.equal(saved.error, null)
})

test('vehicle title migration adds the column, rejects salvage, and can run twice', async () => {
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
      select column_name, is_nullable
      from information_schema.columns
      where table_name = 'vehicles' and column_name = 'title_status'
    `)).rows
    assert.equal(columns.length, 1)
    assert.equal(columns[0].is_nullable, 'YES')
    const id = '11111111-1111-4111-8111-111111111111'
    await db.query(
      'insert into vehicles (id, driver_id, make, model, color, plate, title_status) values ($1, $1, $2, $3, $4, $5, $6)',
      [id, 'Honda', 'Civic', 'White', 'ABC123', 'rebuilt'],
    )
    const row = (await db.query('select title_status, plate from vehicles')).rows[0]
    assert.equal(row.title_status, 'rebuilt')
    assert.equal(row.plate, 'ABC123')
    await db.query('update vehicles set title_status = $1 where id = $2', ['clean', id])
    assert.equal((await db.query('select title_status from vehicles')).rows[0].title_status, 'clean')
    await db.query('update vehicles set title_status = null where id = $1', [id])
    await assert.rejects(
      () => db.query('update vehicles set title_status = $1 where id = $2', ['salvage', id]),
      /vehicles_title_status_check/,
    )
    assert.equal((await db.query('select title_status from vehicles')).rows[0].title_status, null)

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

test('driver sign-up collects title status and the server persists only an allowed value', () => {
  const screen = readFileSync(new URL('../src/screens/DriverOnboarding.jsx', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const driverApp = readFileSync(new URL('../apps/driver/app/onboarding.tsx', import.meta.url), 'utf8')
  const nativeField = readFileSync(new URL('../apps/driver/components/TitleStatusField.tsx', import.meta.url), 'utf8')
  const routes = readFileSync(new URL('../server/driverRoutes.js', import.meta.url), 'utf8')
  const webSave = readFileSync(new URL('../src/lib/driverOnboarding.js', import.meta.url), 'utf8')
  const nativeSave = readFileSync(new URL('../packages/rides-native/driverOnboardingClient.js', import.meta.url), 'utf8')

  assert.match(screen, /Title status/)
  assert.match(screen, /REBUILT_TITLE_HELPER/)
  assert.match(screen, /SALVAGE_TITLE_MESSAGE/)
  assert.match(screen, /role="radiogroup"/)
  assert.match(screen, /titleStatus/)
  assert.match(screen, /titleStatus === 'salvage'/)
  assert.match(styles, /#F56600/)
  assert.match(styles, /#522D80/)
  assert.match(styles, /transition:/)

  assert.match(driverApp, /TitleStatusField/)
  assert.match(driverApp, /titleStatus/)
  assert.match(driverApp, /titleStatus === 'salvage'/)
  assert.match(nativeField, /REBUILT_TITLE_HELPER/)
  assert.match(nativeField, /SALVAGE_TITLE_MESSAGE/)
  assert.match(nativeField, /#F56600/)
  assert.match(nativeField, /#522D80/)
  assert.match(nativeField, /Animated\.timing/)

  assert.match(routes, /titleStatusRejection/)
  assert.match(routes, /withTitleStatus/)
  assert.match(routes, /writeVehicleWithTitleFallback/)
  assert.match(routes, /writeVehicleWithYearFallback/)
  assert.match(webSave, /titleStatusError/)
  assert.match(webSave, /withTitleStatus/)
  assert.match(nativeSave, /titleStatusError/)
  assert.match(nativeSave, /withTitleStatus/)
  assert.doesNotMatch(migration, /drop table|delete from/i)
  assert.match(migration, /add column if not exists title_status/i)
})
