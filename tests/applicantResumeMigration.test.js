import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { REQUIRED_DOC_IDS, IC_AGREEMENT_VERSION } from '../shared/driverOnboarding.js'

const migration = readFileSync(new URL('../supabase/migrations/20261004140000_applicant_electronic_requirements.sql', import.meta.url), 'utf8')

test('electronic requirements migration tolerates legacy file rows but still requires tax and signed IC agreement', async () => {
  const db = new PGlite()
  const id = '11111111-1111-4111-8111-111111111111'
  try {
    await db.exec(`
      create role authenticated; create role service_role;
      create table driver_required_documents (doc_type text primary key);
      create table driver_documents (profile_id uuid, doc_type text);
      create table driver_applications (id uuid, profile_id uuid, onboarding_status text,
        background_authorized_at timestamptz, work_eligibility_attested_at timestamptz, work_eligibility_category text);
      create table driver_tax_info (profile_id uuid, legal_name text, tin_last4 text);
      create table driver_agreement_versions (version text, sha256 text, body_html text);
      create table driver_agreements (profile_id uuid, signer_user_id uuid, agreement_version text,
        agreement_sha256 text, html_snapshot text, signature_name text);
    `)
    for (const doc of [...REQUIRED_DOC_IDS, 'w9', 'background_authorization', 'work_eligibility']) {
      await db.query('insert into driver_required_documents values ($1)', [doc])
    }
    for (const doc of REQUIRED_DOC_IDS) {
      await db.query('insert into driver_documents values ($1, $2)', [id, doc])
    }
    await db.query("insert into driver_applications values ($1, $1, 'approved', now(), now(), 'citizen')", [id])
    await db.exec(migration)
    await db.exec(migration)
    const ready = async () => (await db.query('select driver_submission_ready($1) as ready', [id])).rows[0].ready
    assert.equal(await ready(), false)
    await db.query("insert into driver_tax_info values ($1, 'Test Driver', '1234')", [id])
    assert.equal(await ready(), false)
    await db.query("insert into driver_agreement_versions values ($1, 'hash', 'existing agreement')", [IC_AGREEMENT_VERSION])
    await db.query("insert into driver_agreements values ($1, $1, $2, 'hash', 'existing agreement', 'Test Driver')", [id, IC_AGREEMENT_VERSION])
    assert.equal(await ready(), true)
    await db.query("delete from driver_documents where doc_type = 'license_front'")
    assert.equal(await ready(), false)
    assert.equal((await db.query('select onboarding_status from driver_applications')).rows[0].onboarding_status, 'approved')
    assert.equal((await db.query("select count(*)::int as n from driver_required_documents where doc_type = 'w9'")).rows[0].n, 1)
  } finally {
    await db.close()
  }
})
