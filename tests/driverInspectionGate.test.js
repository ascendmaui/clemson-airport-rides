import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { REQUIRED_DOCUMENTS } from '../shared/driverOnboarding.js'
import { INSPECTION_OVERDUE_COPY } from '../packages/rides-native/vehicleInspection.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const driverId = '11111111-1111-4111-8111-111111111111'
const documentsMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261013106000_driver_documents_go_online.sql'),
  'utf8',
)
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261013107000_vehicle_inspection.sql'),
  'utf8',
)

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role authenticated nologin;
    create role service_role nologin;
    create table public.driver_applications (
      profile_id uuid primary key,
      onboarding_status text
    );
    create table public.driver_documents (
      profile_id uuid,
      doc_type text,
      storage_path text,
      review_status text
    );
    create table public.driver_status (
      driver_id uuid primary key,
      online boolean,
      lat double precision
    );
    create or replace function public.driver_is_approved(uid uuid)
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1 from public.driver_applications
        where profile_id = uid and onboarding_status = 'approved'
      );
    $$;
  `)
  await db.exec(documentsMigration)
  await db.exec(migration)
  return db
}

async function seedApprovedDocuments(db) {
  await db.query('delete from public.driver_documents where profile_id = $1', [driverId])
  for (const doc of REQUIRED_DOCUMENTS) {
    await db.query(
      'insert into public.driver_documents (profile_id, doc_type, storage_path, review_status) values ($1, $2, $3, $4)',
      [driverId, doc.id, `${driverId}/${doc.id}.jpg`, 'approved'],
    )
  }
}

async function seedInspection(db, reviewStatus, source = 'lyft') {
  const rows = [
    ['inspection_front', `${driverId}/inspection_front.jpg`, reviewStatus, null],
    ['inspection_back', `${driverId}/inspection_back.jpg`, reviewStatus, null],
    ['inspection_left', `${driverId}/inspection_left.jpg`, reviewStatus, null],
    ['inspection_right', `${driverId}/inspection_right.jpg`, reviewStatus, null],
    ['inspection_form', `${driverId}/inspection_form.pdf`, reviewStatus, source],
  ]
  for (const [docType, storagePath, status, inspectionSource] of rows) {
    await db.query(
      `insert into public.driver_documents (profile_id, doc_type, storage_path, review_status, inspection_source)
       values ($1, $2, $3, $4, $5)`,
      [driverId, docType, storagePath, status, inspectionSource],
    )
  }
}

async function online(db) {
  return (await db.query('select online from public.driver_status where driver_id = $1', [driverId])).rows[0].online
}

test('the driver home checks inspection after documents and before GO', () => {
  const screen = read('apps/driver/app/(tabs)/index.tsx')
  const documents = read('apps/driver/app/documents.tsx')
  const toggle = screen.slice(screen.indexOf('async function toggle'), screen.indexOf('async function onAccept'))
  const documentsAt = toggle.indexOf('guardGoPress(')
  const inspectionAt = toggle.indexOf('inspectionGoOnlineGate(')
  const goAt = toggle.indexOf('goOnline(')
  const pulseAt = toggle.indexOf('pulseShift(')
  assert.ok(documentsAt >= 0 && inspectionAt > documentsAt && goAt > inspectionAt && pulseAt > goAt)
  assert.match(screen, /INSPECTION_OVERDUE_COPY/)
  assert.match(screen, /inspectionCountdown\(/)
  assert.match(screen, /inspectionHoldGo/)
  assert.match(screen, /disabled=\{!canGoOnline \|\| documentsHoldGo \|\| inspectionHoldGo\}/)
  assert.match(documents, /INSPECTION_TAB_LABEL/)
  assert.match(documents, /INSPECTION_SOURCES\.map/)
  assert.match(documents, /inspectionCountdown\(/)
  assert.match(documents, /uploadDriverDocument\(/)
  assert.doesNotMatch(documents, /supabase\.storage\.from\(/)
  const npmTest = JSON.parse(read('package.json')).scripts.test
  assert.match(npmTest, /packages\/rides-native\/vehicleInspection\.test\.js/)
  assert.match(npmTest, /tests\/driverInspectionGate\.test\.js/)
  const sql = migration.replace(/--[^\n]*/g, '')
  assert.match(migration, /Your vehicle inspection is overdue\. Upload it to go back online/)
  assert.match(migration, /interval '30 days'/)
  assert.match(migration, /first_approved_at/)
  assert.match(migration, /inspection_due_at/)
  assert.doesNotMatch(sql, /is_admin\s*\(/)
  assert.doesNotMatch(sql, /demo/i)
})

test('overdue with no submission blocks on the server, and a late submission unblocks', async () => {
  const db = await database()
  try {
    await db.query(
      'insert into public.driver_applications (profile_id, onboarding_status) values ($1, $2)',
      [driverId, 'approved'],
    )
    await assert.rejects(
      () => db.query('insert into public.driver_status (driver_id, online) values ($1, true)', [driverId]),
      /Your documents need approval before you can go online/,
    )
    await seedApprovedDocuments(db)

    const deadline = (await db.query(
      'select first_approved_at, inspection_due_at from public.driver_inspection_deadlines where profile_id = $1',
      [driverId],
    )).rows[0]
    assert.ok(deadline.first_approved_at)
    assert.equal(
      new Date(deadline.inspection_due_at).getTime() - new Date(deadline.first_approved_at).getTime(),
      30 * 24 * 60 * 60 * 1000,
    )

    await db.query('insert into public.driver_status (driver_id, online) values ($1, true)', [driverId])
    assert.equal(await online(db), true)

    await db.query('update public.driver_status set online = false where driver_id = $1', [driverId])
    await seedInspection(db, 'pending', 'uber')
    await db.query('update public.driver_status set online = true where driver_id = $1', [driverId])
    assert.equal(await online(db), true)

    const stamped = (await db.query(
      'select first_approved_at from public.driver_inspection_deadlines where profile_id = $1',
      [driverId],
    )).rows[0].first_approved_at
    assert.equal(new Date(stamped).toISOString(), new Date(deadline.first_approved_at).toISOString())

    await db.query(
      `delete from public.driver_documents
       where profile_id = $1 and doc_type like 'inspection_%'`,
      [driverId],
    )
    await db.query(
      `update public.driver_inspection_deadlines
       set inspection_due_at = now() - interval '1 day'
       where profile_id = $1`,
      [driverId],
    )
    await db.query('update public.driver_status set online = false where driver_id = $1', [driverId])
    await assert.rejects(
      () => db.query('update public.driver_status set online = true where driver_id = $1', [driverId]),
      new RegExp(INSPECTION_OVERDUE_COPY),
    )
    assert.equal(await online(db), false)

    await db.query(
      `insert into public.driver_documents (profile_id, doc_type, storage_path, review_status)
       values ($1, 'inspection_front', 'front.jpg', 'pending')`,
      [driverId],
    )
    await assert.rejects(
      () => db.query('update public.driver_status set online = true where driver_id = $1', [driverId]),
      new RegExp(INSPECTION_OVERDUE_COPY),
    )

    await seedInspection(db, null, 'independent')
    await db.query('update public.driver_status set online = true where driver_id = $1', [driverId])
    assert.equal(await online(db), true)

    await db.query(
      `update public.driver_documents set review_status = 'rejected'
       where profile_id = $1 and doc_type = 'inspection_form'`,
      [driverId],
    )
    await db.query('update public.driver_status set online = false where driver_id = $1', [driverId])
    await assert.rejects(
      () => db.query('update public.driver_status set online = true where driver_id = $1', [driverId]),
      new RegExp(INSPECTION_OVERDUE_COPY),
    )
    assert.equal(await online(db), false)

    await db.query(
      `update public.driver_documents set review_status = 'pending'
       where profile_id = $1 and doc_type = 'inspection_form'`,
      [driverId],
    )
    await db.query('update public.driver_status set online = true where driver_id = $1', [driverId])
    await db.query(
      `update public.driver_documents set review_status = 'rejected'
       where profile_id = $1 and doc_type = 'inspection_left'`,
      [driverId],
    )
    await db.query('update public.driver_status set lat = 1, online = true where driver_id = $1', [driverId])
    assert.equal(await online(db), false)
  } finally {
    await db.close()
  }
})
