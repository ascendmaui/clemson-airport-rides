import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { REQUIRED_DOCUMENTS } from '../shared/driverOnboarding.js'
import {
  DOCUMENT_CATEGORIES,
  DOCUMENTS_GO_ONLINE_COPY,
  goOnlineDocumentGate,
} from '../packages/rides-native/documentCategories.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261013106000_driver_documents_go_online.sql'),
  'utf8',
)
const driverId = '11111111-1111-4111-8111-111111111111'

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function approvedRows(types = REQUIRED_DOCUMENTS.map((doc) => doc.id)) {
  return types.map((doc_type) => ({ doc_type, review_status: 'approved' }))
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
  await db.exec(migration)
  return db
}

async function seedDocuments(db, rows) {
  await db.query('delete from public.driver_documents where profile_id = $1', [driverId])
  for (const row of rows) {
    await db.query(
      'insert into public.driver_documents (profile_id, doc_type, review_status) values ($1, $2, $3)',
      [driverId, row.doc_type, row.review_status],
    )
  }
}

test('the driver home checks documents before GO and links the banner to Documents', () => {
  const screen = read('apps/driver/app/(tabs)/index.tsx')
  const toggle = screen.slice(screen.indexOf('async function toggle'), screen.indexOf('async function onAccept'))
  const gateAt = toggle.indexOf('guardGoPress(')
  const goAt = toggle.indexOf('goOnline(')
  const pulseAt = toggle.indexOf('pulseShift(')
  assert.ok(gateAt >= 0 && goAt > gateAt && pulseAt > gateAt)
  assert.match(screen, /DOCUMENTS_GO_ONLINE_COPY/)
  assert.match(screen, /documentGate\.sections\.map\(\(section\) => section\.label\)/)
  assert.match(screen, /router\.push\('\/documents'\)/)
  assert.match(screen, /documentsHoldGo/)
  assert.match(screen, /disabled=\{!canGoOnline \|\| documentsHoldGo \|\| inspectionHoldGo\}/)
  assert.doesNotMatch(screen, /review_status\s*===?\s*['"]approved['"]/)
  const npmTest = JSON.parse(read('package.json')).scripts.test
  assert.match(npmTest, /tests\/driverGoOnlineGate\.test\.js/)
})

test('the go-online migration rejects any unapproved category and allows all four approved', async () => {
  const sql = migration.replace(/--[^\n]*/g, '')
  assert.match(migration, /Your documents need approval before you can go online/)
  assert.doesNotMatch(sql, /is_admin\s*\(/)
  assert.doesNotMatch(sql, /demo/i)
  for (const category of DOCUMENT_CATEGORIES) {
    for (const docType of category.docTypes) {
      assert.match(migration, new RegExp(`doc_type = '${docType}'`))
    }
  }

  const db = await database()
  try {
    await db.query(
      'insert into public.driver_applications (profile_id, onboarding_status) values ($1, $2)',
      [driverId, 'approved'],
    )

    await assert.rejects(
      () => db.query('insert into public.driver_status (driver_id, online) values ($1, true)', [driverId]),
      new RegExp(DOCUMENTS_GO_ONLINE_COPY),
    )

    const all = approvedRows()
    for (const category of DOCUMENT_CATEGORIES) {
      const rows = all.map((row) => (
        row.doc_type === category.docTypes[0] ? { ...row, review_status: 'pending' } : row
      ))
      assert.equal(goOnlineDocumentGate(rows).allowed, false)
      assert.deepEqual(
        goOnlineDocumentGate(rows).sections.map((section) => section.label),
        [category.label],
      )
      await seedDocuments(db, rows)
      await assert.rejects(
        () => db.query('insert into public.driver_status (driver_id, online) values ($1, true)', [driverId]),
        new RegExp(DOCUMENTS_GO_ONLINE_COPY),
      )
    }

    await seedDocuments(db, all)
    assert.equal(goOnlineDocumentGate(all).allowed, true)
    await db.query('insert into public.driver_status (driver_id, online) values ($1, true)', [driverId])
    assert.equal((await db.query('select online from public.driver_status')).rows[0].online, true)

    await seedDocuments(db, all.map((row) => (
      row.doc_type === 'registration' ? { ...row, review_status: 'rejected' } : row
    )))
    await db.query('update public.driver_status set lat = 1, online = true where driver_id = $1', [driverId])
    assert.equal((await db.query('select online from public.driver_status')).rows[0].online, false)

    await db.query('update public.driver_status set online = false where driver_id = $1', [driverId])
    await seedDocuments(db, [])
    await db.query('update public.driver_status set online = false where driver_id = $1', [driverId])
    assert.equal((await db.query('select online from public.driver_status')).rows[0].online, false)
  } finally {
    await db.close()
  }
})
