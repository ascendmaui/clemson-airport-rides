import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  BACKGROUND_CHECK_STATUSES,
  VENDOR_CHECK_NOT_PERFORMED,
  assessBackgroundAttestation,
  backgroundAttestationWrite,
  backgroundGateFromApplication,
  backgroundStatusLabel,
  storedBackgroundStatus,
} from '../shared/backgroundCheck.js'
import { REQUIRED_DOC_IDS, approvalBlockers, blockerLabel } from '../shared/driverOnboarding.js'

const migration = readFileSync(new URL('../supabase/migrations/20261007120000_background_check_attestation.sql', import.meta.url), 'utf8')

const CLEAN = { conviction: false, license_action: false, impaired_driving: false }
const FLAGGED = { conviction: true, license_action: false, impaired_driving: false }
const FORBIDDEN = ['clear', 'passed', 'completed']

function signedInput(disclosures) {
  return {
    legalName: 'Ada Lovelace',
    disclosures,
    authorized: true,
    signatureName: 'Ada Lovelace',
    signedOn: '2026-10-07',
  }
}

test('attestation statuses are pending, authorized, or needs review, never a vendor result', () => {
  assert.deepEqual(BACKGROUND_CHECK_STATUSES, ['pending', 'authorized', 'needs_review'])
  const cases = [
    assessBackgroundAttestation(signedInput(CLEAN)),
    assessBackgroundAttestation(signedInput(FLAGGED)),
    assessBackgroundAttestation({ disclosures: CLEAN }),
    assessBackgroundAttestation(signedInput({ conviction: null, license_action: false, impaired_driving: false })),
  ]
  for (const result of cases) {
    assert.equal(FORBIDDEN.includes(result.status), false)
    assert.equal(result.vendorResult, null)
    assert.equal(BACKGROUND_CHECK_STATUSES.includes(result.status), true)
  }
  assert.equal(assessBackgroundAttestation(signedInput(CLEAN)).status, 'authorized')
  assert.equal(assessBackgroundAttestation(signedInput(FLAGGED)).status, 'needs_review')
  assert.equal(assessBackgroundAttestation({}).status, 'pending')
  assert.equal(assessBackgroundAttestation({}).issue, 'Enter your legal name.')
  assert.match(VENDOR_CHECK_NOT_PERFORMED, /not a completed background check/)

  const written = backgroundAttestationWrite(signedInput(FLAGGED))
  assert.equal(written.row.background_check_status, 'needs_review')
  assert.equal(FORBIDDEN.includes(written.row.background_check_status), false)
})

test('a consent timestamp without the attestation status stays pending', () => {
  const row = { background_authorized_at: '2026-09-24T00:00:00Z' }
  assert.equal(storedBackgroundStatus(row), 'pending')
  assert.equal(backgroundGateFromApplication(row).backgroundAuthorized, false)
  assert.match(backgroundStatusLabel('pending', row), /consent checkbox only/)
  assert.match(backgroundStatusLabel('authorized', { background_check_status: 'authorized' }), /no vendor result/)
  assert.match(backgroundStatusLabel('needs_review', { background_check_status: 'needs_review' }), /no vendor result/)
  assert.equal(storedBackgroundStatus({ background_check_status: 'clear' }), 'pending')
})

test('needs review blocks approval until an admin acknowledges the disclosure', () => {
  const ctx = {
    uploaded: REQUIRED_DOC_IDS,
    backgroundAuthorized: true,
    backgroundStatus: 'needs_review',
    backgroundReviewAcknowledged: false,
    workEligibilityAttested: true,
    workEligibilityCategory: 'citizen',
    taxSaved: true,
    agreementSigned: true,
    agreementVersion: 'ic-agreement-2026-10-05',
    applicantEmail: 'ada@clemson.edu',
  }
  assert.ok(approvalBlockers(ctx).includes('background_needs_review'))
  assert.equal(approvalBlockers({ ...ctx, backgroundReviewAcknowledged: true }).includes('background_needs_review'), false)
  assert.match(blockerLabel('background_needs_review'), /disclosure/)
  const pending = approvalBlockers({ ...ctx, backgroundAuthorized: false, backgroundStatus: 'pending' })
  assert.ok(pending.includes('background_authorization_attestation'))
  assert.equal(pending.includes('background_needs_review'), false)
})

test('admin copy shows attestation status and a copyable signing link', () => {
  const admin = readFileSync(new URL('../src/screens/AdminDrivers.jsx', import.meta.url), 'utf8')
  assert.match(admin, /agreementSendOutcome/)
  assert.match(admin, /Copy signing link/)
  assert.match(admin, /acknowledgeBackgroundReview/)
  assert.match(admin, /data-background-status/)
  assert.match(admin, /VENDOR_CHECK_NOT_PERFORMED/)
  assert.doesNotMatch(admin, /Background check: \{employment\.background_authorized_at/)
  const driver = readFileSync(new URL('../apps/driver/app/onboarding.tsx', import.meta.url), 'utf8')
  assert.match(driver, /does not run a background check/)
  assert.doesNotMatch(driver, /queues the background check as pending/)
})

const ADA = '11111111-1111-4111-8111-111111111111'
const BEA = '22222222-2222-4222-8222-222222222222'
const CY = '33333333-3333-4333-8333-333333333333'

async function statusOf(db, id) {
  const row = (await db.query(
    'select background_check_status as status, background_admin_reviewed_at as reviewed from driver_applications where profile_id = $1',
    [id],
  )).rows[0]
  return row
}

test('background attestation migration rejects a fake clear and recomputes status', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated;
      create role service_role;
      create table driver_applications (
        id uuid primary key,
        profile_id uuid,
        background_authorized_at timestamptz
      );
    `)
    await db.exec(migration)
    await db.exec(migration)

    await assert.rejects(
      () => db.query(
        'insert into driver_applications (id, profile_id, background_check_status) values ($1, $1, $2)',
        [ADA, 'clear'],
      ),
      /vendor result|background_status|check constraint/i,
    )

    await db.query(
      `insert into driver_applications (
         id, profile_id, background_check_status, background_disclosures,
         background_authorized_at, background_legal_name, background_signature_name, background_signed_on
       ) values ($1, $1, 'pending', $2::jsonb, now(), 'Ada Lovelace', 'Ada Lovelace', '2026-10-07')`,
      [ADA, JSON.stringify(CLEAN)],
    )
    assert.equal((await statusOf(db, ADA)).status, 'authorized')

    await db.query(
      `insert into driver_applications (
         id, profile_id, background_check_status, background_disclosures,
         background_authorized_at, background_legal_name, background_signature_name, background_signed_on,
         background_admin_reviewed_at
       ) values ($1, $1, 'authorized', $2::jsonb, now(), 'Bea Driver', 'Bea Driver', '2026-10-07', now())`,
      [BEA, JSON.stringify(FLAGGED)],
    )
    const bea = await statusOf(db, BEA)
    assert.equal(bea.status, 'needs_review')
    assert.equal(bea.reviewed, null)

    await db.query(
      `insert into driver_applications (id, profile_id, background_check_status, background_authorized_at)
       values ($1, $1, 'authorized', now())`,
      [CY],
    )
    assert.equal((await statusOf(db, CY)).status, 'pending')

    await db.query(
      `update driver_applications
         set background_check_status = 'authorized', background_admin_reviewed_at = now()
       where profile_id = $1`,
      [BEA],
    )
    const hidden = await statusOf(db, BEA)
    assert.equal(hidden.status, 'needs_review')
    assert.equal(hidden.reviewed, null)

    await db.exec(`create or replace function public.is_service_role() returns boolean language sql stable as $$ select true $$`)
    await db.query('update driver_applications set background_admin_reviewed_at = now() where profile_id = $1', [BEA])
    assert.ok((await statusOf(db, BEA)).reviewed)

    await db.exec(`
      create or replace function public.driver_submission_ready(target uuid)
      returns boolean language sql stable as $$ select true $$;
      create table driver_agreements (
        profile_id uuid, signer_user_id uuid, agreement_version text,
        agreement_sha256 text, signature_name text, signed_at timestamptz
      );
      create table driver_agreement_packets (
        profile_id uuid, agreement_version text, html_sha256 text
      );
    `)
    const ready = async (id) => (await db.query('select driver_approval_ready($1) as ready', [id])).rows[0].ready
    assert.equal(await ready(ADA), false)
    await db.query(
      `insert into driver_agreements values ($1, $1, 'ic-agreement-2026-10-05', 'hash', 'Ada Lovelace', now())`,
      [ADA],
    )
    await db.query(
      `insert into driver_agreements values ($1, $1, 'ic-agreement-2026-10-05', 'hash', 'Bea Driver', now())`,
      [BEA],
    )
    await db.query(
      `insert into driver_agreements values ($1, $1, 'ic-agreement-2026-10-05', 'hash', 'Cy Driver', now())`,
      [CY],
    )
    assert.equal(await ready(ADA), true)
    assert.equal(await ready(BEA), true)
    assert.equal(await ready(CY), false)
  } finally {
    await db.close()
  }
})

test('background attestation migration does nothing destructive when the applications table is missing', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role authenticated; create role service_role;')
    await db.exec(migration)
    await db.exec(migration)
    const table = (await db.query(`select to_regclass('public.driver_applications') as name`)).rows[0].name
    assert.equal(table, null)
    const fn = (await db.query(`select to_regprocedure('public.enforce_background_attestation()') as name`)).rows[0].name
    assert.ok(fn)
  } finally {
    await db.close()
  }
})
