import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'

const file = '20261013230000_align_sign_driver_agreement_version.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const DRIVER = '11111111-1111-4111-8111-111111111111'

test('the agreement migration signs the current version and does not rewrite rows', () => {
  const executable = migration.replace(/--.*$/gm, '')
  assert.equal(IC_AGREEMENT_VERSION, 'ic-agreement-2026-10-05')
  assert.match(executable, /create or replace function public\.sign_driver_agreement/)
  assert.match(executable, /ic-agreement-2026-10-05/)
  assert.equal(executable.includes('ic-agreement-2026-09-24'), false)
  assert.doesNotMatch(migration, /drop table/i)
  assert.doesNotMatch(migration, /delete from/i)
  assert.doesNotMatch(migration, /truncate/i)
})

test('sign_driver_agreement writes the version driver_approval_ready expects', async () => {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create role authenticated nologin;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles (id uuid primary key);
    create table public.driver_agreement_versions (
      version text primary key,
      title text not null,
      body_html text not null,
      sha256 text not null
    );
    create table public.driver_agreements (
      id uuid primary key default gen_random_uuid(),
      profile_id uuid not null references public.profiles (id),
      agreement_version text not null references public.driver_agreement_versions (version),
      agreement_sha256 text not null,
      signature_name text not null,
      signed_at timestamptz not null default now(),
      signer_user_id uuid not null,
      html_snapshot text not null,
      unique (profile_id, agreement_version)
    );
    insert into public.profiles (id) values ('${DRIVER}');
    insert into public.driver_agreement_versions (version, title, body_html, sha256)
    values
      ('ic-agreement-2026-09-24', 'Old', '<p>old</p>', 'old-hash'),
      ('ic-agreement-2026-10-05', 'Current', '<p>current</p>', 'current-hash');
  `)
  await db.exec(`
    create or replace function public.sign_driver_agreement(signature_name text)
    returns jsonb language plpgsql security definer set search_path = public as $$
    declare ver public.driver_agreement_versions;
    begin
      select * into ver from public.driver_agreement_versions where version = 'ic-agreement-2026-09-24';
      insert into public.driver_agreements (
        profile_id, agreement_version, agreement_sha256, signature_name, signer_user_id, html_snapshot
      ) values (
        auth.uid(), ver.version, ver.sha256, signature_name, auth.uid(), ver.body_html
      );
      return jsonb_build_object('agreement_version', ver.version);
    end $$;
  `)
  await db.exec(migration)
  // PGlite checks the invoker's table privileges inside this security definer
  // function. Production runs it as the owner, which already has those rights.
  await db.exec(`
    grant select, insert, update on public.driver_agreements to authenticated;
    grant select on public.driver_agreement_versions to authenticated;
  `)
  await db.exec(`
    select set_config('request.jwt.claim.sub', '${DRIVER}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    set role authenticated;
  `)
  const signed = await db.query(`select public.sign_driver_agreement('Ada Lovelace') as signed`)
  assert.equal(signed.rows[0].signed.agreement_version, 'ic-agreement-2026-10-05')
  const row = (await db.query(`
    select agreement_version, agreement_sha256, html_snapshot, signature_name
    from public.driver_agreements
  `)).rows[0]
  assert.equal(row.agreement_version, 'ic-agreement-2026-10-05')
  assert.equal(row.agreement_sha256, 'current-hash')
  assert.equal(row.html_snapshot, '<p>current</p>')
  assert.equal(row.signature_name, 'Ada Lovelace')
  assert.equal(row.agreement_version === 'ic-agreement-2026-09-24', false)

  const again = await db.query(`select public.sign_driver_agreement('Ada Byron') as signed`)
  assert.equal(again.rows[0].signed.agreement_version, 'ic-agreement-2026-10-05')
  const rows = await db.query(`select agreement_version, signature_name from public.driver_agreements`)
  assert.equal(rows.rows.length, 1)
  assert.equal(rows.rows[0].signature_name, 'Ada Byron')
  assert.equal(rows.rows[0].agreement_version, 'ic-agreement-2026-10-05')
})
