import assert from 'node:assert/strict'
import test from 'node:test'
import { autoNavigationLeg, autoNavigationKey, readLaunchedLegs, withLaunchedLeg } from './autoNavigation.js'

const now = Date.parse('2026-10-09T15:00:00Z')
const justNow = new Date(now - 20_000).toISOString()

test('a fresh accept opens navigation to pickup once', () => {
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: justNow, now }), 'pickup')
  assert.equal(autoNavigationLeg({ status: 'arriving', acceptedAt: justNow, now }), 'pickup')
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: justNow, launched: ['pickup'], now }), null)
})

test('starting the trip opens navigation to drop-off once', () => {
  assert.equal(autoNavigationLeg({ status: 'in_progress', launched: ['pickup'], now }), 'dropoff')
  assert.equal(autoNavigationLeg({ status: 'in_progress', launched: ['pickup', 'dropoff'], now }), null)
})

test('the setting turns both legs off', () => {
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: justNow, enabled: false, now }), null)
  assert.equal(autoNavigationLeg({ status: 'in_progress', enabled: false, now }), null)
})

test('stale accepts and far-off scheduled pickups do not open maps', () => {
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: new Date(now - 11 * 60_000).toISOString(), now }), null)
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: null, now }), null)
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: justNow, pickupAt: new Date(now + 2 * 3600_000).toISOString(), now }), null)
  assert.equal(autoNavigationLeg({ status: 'accepted', acceptedAt: justNow, pickupAt: new Date(now + 10 * 60_000).toISOString(), now }), 'pickup')
})

test('other statuses never open maps', () => {
  for (const status of ['arrived', 'completed', 'canceled', 'canceled_midride', 'cancelled_wait', 'searching', null]) {
    assert.equal(autoNavigationLeg({ status, acceptedAt: justNow, now }), null)
  }
})

test('launched legs storage is tolerant', () => {
  assert.equal(autoNavigationKey('t1'), 'driver.auto-nav.t1')
  assert.deepEqual(readLaunchedLegs(null), [])
  assert.deepEqual(readLaunchedLegs('nope'), [])
  assert.deepEqual(readLaunchedLegs('["pickup","x"]'), ['pickup'])
  assert.deepEqual(withLaunchedLeg(['pickup'], 'dropoff'), ['pickup', 'dropoff'])
  assert.deepEqual(withLaunchedLeg(['pickup'], 'pickup'), ['pickup'])
})

test('carpool stops open the nav app once per stop after Start', async () => {
  const { autoNavigationStopLeg, readLaunchedLegs, withLaunchedLeg } = await import('./autoNavigation.js')
  assert.equal(autoNavigationStopLeg({ stopIndex: 1, launched: ['pickup'] }), 'stop:1')
  const launched = withLaunchedLeg(['pickup'], 'stop:1')
  assert.deepEqual(readLaunchedLegs(JSON.stringify(launched)), ['pickup', 'stop:1'])
  assert.equal(autoNavigationStopLeg({ stopIndex: 1, launched }), null)
  assert.equal(autoNavigationStopLeg({ stopIndex: 2, launched }), 'stop:2')
  assert.equal(autoNavigationStopLeg({ stopIndex: 2, launched, enabled: false }), null)
  assert.equal(autoNavigationStopLeg({ stopIndex: null, launched }), null)
})
