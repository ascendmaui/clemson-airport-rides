import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { EMAIL_TODO } from '../shared/driverOnboarding.js'
import {
  missingApplicantEmailColumn,
  normalizeApplicantEmail,
  readStoredApplicantEmail,
  selectDriverApplicationQueue,
  submittedApplicantEmail,
  withApplicantEmail,
  withSubmittedApplicantEmail,
  writeDriverApplication,
} from '../shared/applicantEmail.js'

const migration = readFileSync(new URL('../supabase/migrations/20261004223000_driver_application_applicant_email.sql', import.meta.url), 'utf8')

test('submitted applicant email prefers the address stored on the application', () => {
  assert.equal(normalizeApplicantEmail('  Ada@Clemson.edu '), 'ada@clemson.edu')
  assert.equal(normalizeApplicantEmail('not-an-email'), '')
  assert.equal(
    submittedApplicantEmail(
      { applicant_email: 'submitted@clemson.edu' },
      { email: 'profile@gmail.com' },
    ),
    'submitted@clemson.edu',
  )
  assert.equal(
    submittedApplicantEmail({ applicant_email: '' }, { email: 'Profile@gmail.com' }),
    'profile@gmail.com',
  )
  assert.equal(submittedApplicantEmail({}, {}), '')
})

test('admin queue row exposes the submitted email even when the profile email differs or is missing', () => {
  const row = withSubmittedApplicantEmail(
    { id: 'app-1', profile_id: 'user-1', applicant_email: 'submitted@clemson.edu' },
    { id: 'user-1', full_name: 'Ada', email: 'other@gmail.com' },
  )
  assert.equal(row.applicant_email, 'submitted@clemson.edu')
  assert.equal(row.profile.email, 'submitted@clemson.edu')
  assert.equal(row.profile.full_name, 'Ada')

  const fromProfile = withSubmittedApplicantEmail(
    { id: 'app-2', profile_id: 'user-2' },
    { id: 'user-2', full_name: 'Bea', email: 'bea@clemson.edu' },
  )
  assert.equal(fromProfile.applicant_email, 'bea@clemson.edu')
  assert.equal(fromProfile.profile.email, 'bea@clemson.edu')

  const storedOnly = withSubmittedApplicantEmail(
    { id: 'app-3', profile_id: 'user-3', applicant_email: 'cy@gmail.com' },
    null,
  )
  assert.equal(storedOnly.applicant_email, 'cy@gmail.com')
  assert.equal(storedOnly.profile.email, 'cy@gmail.com')
})

test('application writes include a normalized applicant email and retry without the column', async () => {
  assert.deepEqual(
    withApplicantEmail({ profile_id: 'user-1' }, 'Tiger@Clemson.edu'),
    { profile_id: 'user-1', applicant_email: 'tiger@clemson.edu' },
  )
  assert.deepEqual(withApplicantEmail({ profile_id: 'user-1' }, ''), { profile_id: 'user-1' })
  assert.equal(
    missingApplicantEmailColumn({ message: "Could not find the 'applicant_email' column of 'driver_applications' in the schema cache" }),
    true,
  )
  assert.equal(missingApplicantEmailColumn({ message: 'permission denied' }), false)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('applicant email storage must not send mail')
  }
  try {
    let calls = 0
    const saved = await writeDriverApplication(async (payload) => {
      calls += 1
      assert.equal(payload.applicant_email, 'tiger@clemson.edu')
      return { data: { id: 'app', ...payload }, error: null }
    }, { profile_id: 'user-1' }, 'Tiger@Clemson.edu')
    assert.equal(calls, 1)
    assert.equal(saved.data.applicant_email, 'tiger@clemson.edu')

    const payloads = []
    const retried = await writeDriverApplication(async (payload) => {
      payloads.push(payload)
      if (payloads.length === 1) {
        return {
          data: null,
          error: { message: "Could not find the 'applicant_email' column of 'driver_applications' in the schema cache" },
        }
      }
      return { data: { id: 'app', ...payload }, error: null }
    }, { profile_id: 'user-1' }, 'Tiger@Clemson.edu')
    assert.equal(payloads.length, 2)
    assert.equal(Object.prototype.hasOwnProperty.call(payloads[1], 'applicant_email'), false)
    assert.equal(retried.data.profile_id, 'user-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('queue select falls back when applicant_email is not in the schema and does not send', async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => {
    fetches += 1
    throw new Error('queue load must not send mail')
  }
  try {
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
          order() { return api },
          eq(column, value) {
            assert.equal(column, 'onboarding_status')
            assert.equal(value, 'pending_review')
            return api
          },
          then(resolve, reject) {
            const error = /applicant_email/.test(state.cols)
              ? { message: 'column applicant_email does not exist' }
              : null
            return Promise.resolve({
              data: error ? null : [{ id: 'app-1', profile_id: 'user-1' }],
              error,
            }).then(resolve, reject)
          },
        }
        return api
      },
    }
    const result = await selectDriverApplicationQueue(sb, 'id, profile_id', 'pending_review')
    assert.equal(result.error, null)
    assert.equal(result.data[0].id, 'app-1')
    assert.deepEqual(seen, ['id, profile_id, applicant_email', 'id, profile_id'])
    assert.equal(fetches, 0)

    const stored = await readStoredApplicantEmail({
      from() {
        const api = {
          select() { return api },
          eq() { return api },
          maybeSingle: async () => ({
            data: null,
            error: { message: "Could not find the 'applicant_email' column of 'driver_applications' in the schema cache" },
          }),
        }
        return api
      },
    }, 'user-1')
    assert.deepEqual(stored, { email: '', error: null })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('review list copy shows the submitted email and does not send mail', () => {
  const screen = readFileSync(new URL('../src/screens/AdminDrivers.jsx', import.meta.url), 'utf8')
  assert.match(screen, /submittedApplicantEmail/)
  assert.match(screen, /data-applicant-email/)
  assert.match(screen, />Email</)
  assert.equal(EMAIL_TODO.includes('without email'), false)
  assert.match(EMAIL_TODO, /#\/admin/)
  assert.match(EMAIL_TODO, /email submitted/)
  assert.doesNotMatch(screen, /api\.resend\.com|sendApplicantNotice|DRIVER_OFFER_ALERT_EMAIL/)

  const routes = readFileSync(new URL('../server/driverRoutes.js', import.meta.url), 'utf8')
  assert.equal((routes.match(/notifyAdminOfApplication\(/g) || []).length, 1)
  assert.match(routes, /writeDriverApplication/)
  assert.doesNotMatch(routes, /api\.resend\.com|DRIVER_OFFER_ALERT_EMAIL\s*=\s*send/)

  const helper = readFileSync(new URL('../shared/applicantEmail.js', import.meta.url), 'utf8')
  const migrationSql = readFileSync(new URL('../supabase/migrations/20261004223000_driver_application_applicant_email.sql', import.meta.url), 'utf8')
  const adminApi = readFileSync(new URL('../api/admin-drivers.js', import.meta.url), 'utf8')
  for (const source of [helper, migrationSql, adminApi, screen]) {
    assert.doesNotMatch(source, /api\.resend\.com|sendApplicantNotice|DRIVER_OFFER_ALERT_EMAIL/)
  }
  assert.match(migrationSql, /add column if not exists applicant_email/i)
  assert.doesNotMatch(migrationSql, /create table/i)
})

test('applicant email migration is safe when the column already exists and backfills blank rows', async () => {
  const db = new PGlite()
  const ada = '11111111-1111-4111-8111-111111111111'
  const bea = '22222222-2222-4222-8222-222222222222'
  const cy = '33333333-3333-4333-8333-333333333333'
  const dee = '44444444-4444-4444-8444-444444444444'
  try {
    await db.exec(`
      create table profiles (id uuid primary key, email text, full_name text);
      create table driver_applications (
        id uuid primary key,
        profile_id uuid,
        applicant_email text,
        onboarding_status text
      );
      create schema auth;
      create table auth.users (id uuid primary key, email text);
    `)
    await db.query('insert into profiles values ($1, $2, $3)', [ada, '  Ada@Clemson.edu ', 'Ada'])
    await db.query('insert into profiles values ($1, $2, $3)', [bea, 'other@gmail.com', 'Bea'])
    await db.query('insert into profiles values ($1, $2, $3)', [cy, '   ', 'Cy'])
    await db.query('insert into profiles values ($1, $2, $3)', [dee, 'dee@clemson.edu', 'Dee'])
    await db.query('insert into auth.users values ($1, $2)', [cy, '  Cy@Gmail.com '])
    await db.query("insert into driver_applications values ($1, $1, null, 'pending_review')", [ada])
    await db.query("insert into driver_applications values ($1, $1, 'kept@example.com', 'pending_review')", [bea])
    await db.query("insert into driver_applications values ($1, $1, '', 'pending_review')", [cy])
    await db.query("insert into driver_applications values ($1, $1, '   ', 'pending_docs')", [dee])

    await db.exec(migration)
    await db.exec(migration)

    const rows = (await db.query('select profile_id, applicant_email from driver_applications order by profile_id')).rows
    const byId = Object.fromEntries(rows.map((row) => [row.profile_id, row.applicant_email]))
    assert.equal(byId[ada], 'ada@clemson.edu')
    assert.equal(byId[bea], 'kept@example.com')
    assert.equal(byId[cy], 'cy@gmail.com')
    assert.equal(byId[dee], 'dee@clemson.edu')
  } finally {
    await db.close()
  }
})

test('applicant email migration adds a missing column and skips a missing applications table', async () => {
  const db = new PGlite()
  const ada = '11111111-1111-4111-8111-111111111111'
  try {
    await db.exec(`
      create table profiles (id uuid primary key, email text);
      create table driver_applications (id uuid primary key, profile_id uuid, onboarding_status text);
    `)
    await db.query('insert into profiles values ($1, $2)', [ada, 'Ada@Clemson.edu'])
    await db.query("insert into driver_applications values ($1, $1, 'pending_review')", [ada])
    await db.exec(migration)
    await db.exec(migration)
    const row = (await db.query('select applicant_email from driver_applications')).rows[0]
    assert.equal(row.applicant_email, 'ada@clemson.edu')

    const empty = new PGlite()
    try {
      await empty.exec(migration)
      await empty.exec(migration)
    } finally {
      await empty.close()
    }
  } finally {
    await db.close()
  }
})
