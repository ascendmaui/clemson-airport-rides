import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cronEndpointsDisabled,
  stagingDryRunAllowed,
  stagingCronBlock,
} from '../server/cronGuard.js'

/* ── cronEndpointsDisabled ───────────────────────────────────────── */

test('cronEndpointsDisabled: returns true when DISABLE_CRON_ENDPOINTS is "1"', () => {
  assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: '1' }), true)
})

test('cronEndpointsDisabled: returns true when DISABLE_CRON_ENDPOINTS is "true"', () => {
  assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: 'true' }), true)
})

test('cronEndpointsDisabled: returns true when DISABLE_CRON_ENDPOINTS is "TRUE" (case insensitive)', () => {
  assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: 'TRUE' }), true)
})

test('cronEndpointsDisabled: returns false when DISABLE_CRON_ENDPOINTS is "0"', () => {
  assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: '0' }), false)
})

test('cronEndpointsDisabled: returns false when DISABLE_CRON_ENDPOINTS is empty', () => {
  assert.equal(cronEndpointsDisabled({ DISABLE_CRON_ENDPOINTS: '' }), false)
})

test('cronEndpointsDisabled: returns false when DISABLE_CRON_ENDPOINTS is missing', () => {
  assert.equal(cronEndpointsDisabled({}), false)
})

test('cronEndpointsDisabled: returns false when env is null', () => {
  assert.equal(cronEndpointsDisabled(null), false)
})

/* ── stagingDryRunAllowed ────────────────────────────────────────── */

test('stagingDryRunAllowed: returns true when ALLOW_STAGING_DRY_RUN is "1"', () => {
  assert.equal(stagingDryRunAllowed({ ALLOW_STAGING_DRY_RUN: '1' }), true)
})

test('stagingDryRunAllowed: returns false when ALLOW_STAGING_DRY_RUN is missing', () => {
  assert.equal(stagingDryRunAllowed({}), false)
})

test('stagingDryRunAllowed: returns true when ALLOW_STAGING_DRY_RUN is "true"', () => {
  assert.equal(stagingDryRunAllowed({ ALLOW_STAGING_DRY_RUN: 'true' }), true)
})

/* ── stagingCronBlock ────────────────────────────────────────────── */

test('stagingCronBlock: returns null when cron endpoints are NOT disabled', () => {
  const result = stagingCronBlock({ DISABLE_CRON_ENDPOINTS: '0' })
  assert.equal(result, null)
})

test('stagingCronBlock: returns null when env has no DISABLE_CRON_ENDPOINTS', () => {
  const result = stagingCronBlock({})
  assert.equal(result, null)
})

test('stagingCronBlock: returns 403 when cron endpoints disabled and not dry-run', () => {
  const result = stagingCronBlock({ DISABLE_CRON_ENDPOINTS: '1' })
  assert.notEqual(result, null)
  assert.equal(result.status, 403)
  assert.ok(result.body.error.includes('Cron endpoints are disabled'))
})

test('stagingCronBlock: returns 403 for dry-run when ALLOW_STAGING_DRY_RUN is off', () => {
  const result = stagingCronBlock({ DISABLE_CRON_ENDPOINTS: '1' }, { dryRun: true })
  assert.notEqual(result, null)
  assert.equal(result.status, 403)
  assert.ok(result.body.error.includes('Dry-run is disabled'))
})

test('stagingCronBlock: returns null for dry-run when ALLOW_STAGING_DRY_RUN is "1"', () => {
  const result = stagingCronBlock(
    { DISABLE_CRON_ENDPOINTS: '1', ALLOW_STAGING_DRY_RUN: '1' },
    { dryRun: true },
  )
  assert.equal(result, null)
})

test('stagingCronBlock: still blocks non-dry-run even when ALLOW_STAGING_DRY_RUN is on', () => {
  const result = stagingCronBlock(
    { DISABLE_CRON_ENDPOINTS: '1', ALLOW_STAGING_DRY_RUN: '1' },
    { dryRun: false },
  )
  assert.notEqual(result, null)
  assert.equal(result.status, 403)
})

test('stagingCronBlock: blocks when dry-run is not specified and cron disabled', () => {
  const result = stagingCronBlock({ DISABLE_CRON_ENDPOINTS: '1' }, {})
  assert.notEqual(result, null)
  assert.equal(result.status, 403)
})

test('stagingCronBlock: returns null with default env when cron not disabled', () => {
  // Calling with default env (process.env) should not error; just verify the shape
  const result = stagingCronBlock({ DISABLE_CRON_ENDPOINTS: 'false' })
  assert.equal(result, null)
})
