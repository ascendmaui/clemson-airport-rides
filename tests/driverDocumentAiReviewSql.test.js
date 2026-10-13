import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const file = '20261013220000_driver_document_ai_review.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const DRIVER = '11111111-1111-4111-8111-111111111111'

test('document AI review migration is additive and uses a unique version', () => {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013220000').length, 1)
  assert.doesNotMatch(migration, /drop table/i)
  assert.doesNotMatch(migration, /delete from/i)
  assert.doesNotMatch(migration, /truncate/i)
  assert.match(migration, /add column if not exists ai_verdict/i)
  assert.match(migration, /add column if not exists ai_confidence/i)
  assert.match(migration, /add column if not exists ai_reason/i)
  assert.match(migration, /add column if not exists ai_reasons/i)
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
    create table public.profiles (id uuid primary key, full_name text);
    create table public.vehicles (driver_id uuid, plate text);
    create table public.driver_documents (
      id uuid primary key default gen_random_uuid(),
      profile_id uuid references public.profiles (id),
      doc_type text,
      storage_path text,
      review_status text,
      review_note text,
      created_at timestamptz default now()
    );
    insert into public.profiles (id, full_name) values ('${DRIVER}', 'Ada Driver');
  `)
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(`
    grant select, insert, update on public.driver_documents to authenticated;
    grant select, insert, update on public.driver_documents to service_role;
  `)
  return db
}

test('drivers cannot approve their own document, and service role can store the AI result', async () => {
  const db = await setup()
  const columns = await db.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'driver_documents'
  `)
  const names = columns.rows.map((row) => row.column_name)
  for (const column of ['ai_verdict', 'ai_confidence', 'ai_reason', 'ai_reasons', 'ai_extraction', 'reviewed_at', 'reviewed_by']) {
    assert.equal(names.includes(column), true, column)
  }
  const vehicleColumns = await db.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'vin'
  `)
  assert.equal(vehicleColumns.rows.length, 1)

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${DRIVER}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    set role authenticated;
  `)
  await db.exec(`
    insert into public.driver_documents
      (profile_id, doc_type, storage_path, review_status, ai_verdict, ai_confidence, ai_reason)
    values
      ('${DRIVER}', 'registration', '${DRIVER}/registration/self.jpg', 'approved', 'approved', 0.990, 'self approved');
  `)
  let row = (await db.query(`
    select review_status, ai_verdict, ai_confidence, ai_reason
    from public.driver_documents
  `)).rows[0]
  assert.equal(row.review_status, 'pending_manual_review')
  assert.equal(row.ai_verdict, null)
  assert.equal(row.ai_confidence, null)
  assert.equal(row.ai_reason, null)

  await db.exec(`
    update public.driver_documents
      set review_status = 'approved', ai_verdict = 'approved', ai_confidence = 0.990
  `)
  row = (await db.query('select review_status, ai_verdict from public.driver_documents')).rows[0]
  assert.equal(row.review_status, 'pending_manual_review')
  assert.equal(row.ai_verdict, null)

  await db.exec('reset role')
  await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`)
  await db.exec(`
    update public.driver_documents
      set review_status = 'approved',
          ai_verdict = 'approved',
          ai_confidence = 0.910,
          ai_reason = 'The document matches your profile and is clear enough to approve.',
          ai_reasons = '["The document matches your profile and is clear enough to approve."]'::jsonb
  `)
  row = (await db.query(`
    select review_status, ai_verdict, ai_confidence, ai_reason from public.driver_documents
  `)).rows[0]
  assert.equal(row.review_status, 'approved')
  assert.equal(row.ai_verdict, 'approved')
  assert.equal(Number(row.ai_confidence), 0.91)

  await db.exec(`
    select set_config('request.jwt.claim.role', 'authenticated', false);
    set role authenticated;
  `)
  await db.exec(`
    update public.driver_documents
      set storage_path = '${DRIVER}/registration/replaced.jpg',
          review_status = 'approved',
          ai_verdict = 'approved'
  `)
  row = (await db.query(`
    select review_status, ai_verdict, storage_path from public.driver_documents
  `)).rows[0]
  assert.equal(row.review_status, 'pending_manual_review')
  assert.equal(row.ai_verdict, null)
  assert.match(row.storage_path, /replaced/)

  await db.exec('reset role')
  await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`)
  await assert.rejects(
    () => db.exec(`
      insert into public.driver_documents (profile_id, doc_type, storage_path, ai_verdict)
      values ('${DRIVER}', 'license_front', '${DRIVER}/license_front/bad.jpg', 'rejected')
    `),
    /driver_documents_ai_verdict_check/,
  )
})
