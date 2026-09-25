import assert from 'node:assert/strict'
import test from 'node:test'
import { canReceiveRides, driverApprovalStatus } from './driverApproval.js'
import { ONBOARDING_STATUSES } from '../shared/driverOnboarding.js'

function fakeApplicationsSb({ data = null, error = null } = {}) {
  const calls = []
  return {
    calls,
    sb: {
      from(table) {
        calls.push({ op: 'from', table })
        return {
          select(columns) {
            calls.push({ op: 'select', columns })
            return {
              eq(col, val) {
                calls.push({ op: 'eq', col, val })
                return {
                  async maybeSingle() {
                    calls.push({ op: 'maybeSingle' })
                    return { data, error }
                  },
                }
              },
            }
          },
        }
      },
    },
  }
}

test('canReceiveRides is true only for approved among every ONBOARDING_STATUSES value', () => {
  assert.ok(ONBOARDING_STATUSES.includes('approved'))
  for (const status of ONBOARDING_STATUSES) {
    assert.equal(canReceiveRides(status), status === 'approved', String(status))
  }
})

test('canReceiveRides is false for null, undefined, and garbage', () => {
  assert.equal(canReceiveRides(null), false)
  assert.equal(canReceiveRides(undefined), false)
  const garbage = [
    '',
    'pending',
    'none',
    'Under review',
    'APPROVED',
    'approved ',
    0,
    1,
    false,
    true,
    {},
    [],
  ]
  for (const status of garbage) {
    assert.equal(canReceiveRides(status), false, String(status))
  }
})

test('driverApprovalStatus: approved application is approved', async () => {
  const profileId = 'driver-approved'
  const { sb, calls } = fakeApplicationsSb({
    data: { onboarding_status: 'approved' },
  })
  const gate = await driverApprovalStatus(sb, profileId)
  assert.deepEqual(gate, { approved: true, status: 'approved', error: null })
  assert.equal(calls.find((c) => c.op === 'from')?.table, 'driver_applications')
  assert.equal(calls.find((c) => c.op === 'select')?.columns, 'onboarding_status')
  assert.deepEqual(calls.find((c) => c.op === 'eq'), {
    op: 'eq',
    col: 'profile_id',
    val: profileId,
  })
})

test('driverApprovalStatus: pending_review is not approved', async () => {
  const { sb } = fakeApplicationsSb({
    data: { onboarding_status: 'pending_review' },
  })
  const gate = await driverApprovalStatus(sb, 'driver-pending')
  assert.deepEqual(gate, { approved: false, status: 'pending_review', error: null })
})

test('driverApprovalStatus: missing row is not approved', async () => {
  const { sb } = fakeApplicationsSb({ data: null, error: null })
  const gate = await driverApprovalStatus(sb, 'driver-missing')
  assert.deepEqual(gate, { approved: false, status: null, error: null })
})

test('driverApprovalStatus: db error is not approved', async () => {
  const { sb } = fakeApplicationsSb({
    data: { onboarding_status: 'approved' },
    error: { message: 'schema cache miss' },
  })
  const gate = await driverApprovalStatus(sb, 'driver-error')
  assert.deepEqual(gate, { approved: false, status: null, error: 'schema cache miss' })
})
