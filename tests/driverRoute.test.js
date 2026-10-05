import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { driverRouteForOnboarding } from '../shared/driverRoute.js'

test('approved drivers open #/driver and everyone else stays on the application', () => {
  assert.equal(driverRouteForOnboarding('approved'), 'driver')
  for (const status of ['pending_info', 'pending_docs', 'pending_review', 'rejected', null, undefined, '']) {
    assert.equal(driverRouteForOnboarding(status), 'driver-onboarding')
  }
})

test('an approved #/driver-onboarding visit opens driver mode instead of the approval card', () => {
  const screen = readFileSync(new URL('../src/screens/DriverOnboarding.jsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  const gate = readFileSync(new URL('../src/screens/DriverApprovalGate.jsx', import.meta.url), 'utf8')
  assert.match(screen, /driverRouteForOnboarding\(status\) !== 'driver'/)
  assert.match(screen, /navigate\('driver'\)/)
  assert.match(screen, /Opening driver mode/)
  assert.match(screen, /view'\) === 'application'/)
  assert.match(home, /driverRouteForOnboarding\(application\?\.onboarding_status\) === 'driver'/)
  assert.doesNotMatch(home, /navigate\('driver-onboarding'\)/)
  assert.match(gate, /navigate\(driverRouteForOnboarding\(status\)\)/)
  assert.doesNotMatch(gate, /navigate\('driver-onboarding'\)/)
})
