import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const file = '20261013180000_driver_profile_photo_ai_review.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const DRIVER = '11111111-1111-4111-8111-111111111111'

test('profile photo AI review migration is additive and uses a unique version', () => {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013180000').length, 1)
  assert.equal(file.startsWith('20261013180000'), true)
  assert.doesNotMatch(migration, /drop table/i)
  assert.doesNotMatch(migration, /delete from/i)
  assert.doesNotMatch(migration, /truncate/i)
  assert.match(migration, /add column if not exists ai_verdict/i)
  assert.match(migration, /add column if not exists ai_confidence/i)
  assert.match(migration, /add column if not exists ai_reason/i)
  assert.match(migration, /needs_admin/)
  assert.doesNotMatch(migration, /ai_verdict in \([^)]*'rejected'/)
})

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function public.is_admin() returns boolean language sql stable as $$ select false $$;
    create table public.profiles (id uuid primary key, full_name text);
    insert into public.profiles (id, full_name) values ('${DRIVER}', 'Ada Driver');
  `)
  await db.exec(migration)
  await db.exec(migration)
  return db
}

test('drivers cannot approve or reject their own photo, and the AI columns persist', async () => {
  const db = await setup()
  const columns = await db.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'driver_profile_photos'
  `)
  const names = columns.rows.map((row) => row.column_name)
  for (const column of ['ai_verdict', 'ai_confidence', 'ai_reason', 'review_note', 'reviewed_at', 'reviewed_by']) {
    assert.equal(names.includes(column), true, column)
  }

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${DRIVER}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    set role authenticated;
  `)
  await db.exec(`
    insert into public.driver_profile_photos
      (profile_id, storage_path, review_status, ai_verdict, ai_confidence, ai_reason)
    values
      ('${DRIVER}', '${DRIVER}/profile_photo/self.jpg', 'approved', 'approved', 0.990, 'self approved');
  `)
  let row = (await db.query(`select review_status, ai_verdict, ai_confidence, ai_reason from public.driver_profile_photos`)).rows[0]
  assert.equal(row.review_status, 'pending_admin_review')
  assert.equal(row.ai_verdict, null)
  assert.equal(row.ai_confidence, null)
  assert.equal(row.ai_reason, null)

  await assert.rejects(
    () => db.exec(`update public.driver_profile_photos set review_status = 'rejected'`),
    /permission denied/i,
  )

  await db.exec('reset role')
  await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`)
  await db.exec(`
    update public.driver_profile_photos
      set review_status = 'approved',
          ai_verdict = 'approved',
          ai_confidence = 0.930,
          ai_reason = 'Clear photo of one face that matches the license on file.'
  `)
  row = (await db.query(`select review_status, ai_verdict, ai_confidence, ai_reason from public.driver_profile_photos`)).rows[0]
  assert.equal(row.review_status, 'approved')
  assert.equal(row.ai_verdict, 'approved')
  assert.equal(Number(row.ai_confidence), 0.93)
  assert.match(row.ai_reason, /matches the license/)

  await assert.rejects(
    () => db.exec(`
      insert into public.driver_profile_photos (profile_id, storage_path, ai_verdict)
      values ('${DRIVER}', '${DRIVER}/profile_photo/bad.jpg', 'rejected')
    `),
    /driver_profile_photos_ai_verdict_check/,
  )
})
