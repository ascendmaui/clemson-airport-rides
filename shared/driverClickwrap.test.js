import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLICKWRAP_STORAGE_KEY,
  DRIVER_CLICKWRAP_SUMMARY,
  DRIVER_CLICKWRAP_VERSION,
  acceptClickwrap,
  agreeButtonDisabled,
  legalDocument,
  loadDriverClickwrapPhase,
  mayCreateDriverAccount,
  mayEnterOnboarding,
  needsClickwrapPrompt,
} from './driverClickwrap.js'

const CURRENT = {
  userId: 'driver-1',
  agreementVersion: DRIVER_CLICKWRAP_VERSION,
  acceptedAt: '2026-10-13T12:00:00.000Z',
}

test('I Agree stays disabled until the checkbox is checked', () => {
  assert.equal(agreeButtonDisabled(false), true)
  assert.equal(agreeButtonDisabled(undefined), true)
  assert.equal(agreeButtonDisabled(null), true)
  assert.equal(agreeButtonDisabled(true), false)
  assert.equal(acceptClickwrap({ checked: false }), false)
  assert.equal(acceptClickwrap({ checked: true }), true)
})

test('a driver cannot create an account or enter onboarding without the current acceptance', () => {
  assert.equal(mayCreateDriverAccount(false), false)
  assert.equal(mayCreateDriverAccount(undefined), false)
  assert.equal(mayCreateDriverAccount(true), true)
  assert.equal(mayEnterOnboarding(null), false)
  assert.equal(mayEnterOnboarding({ userId: 'driver-1', agreementVersion: 'driver-clickwrap-2026-01-01', acceptedAt: CURRENT.acceptedAt }), false)
  assert.equal(mayEnterOnboarding({ userId: 'driver-1', agreementVersion: DRIVER_CLICKWRAP_VERSION }), false)
  assert.equal(mayEnterOnboarding(CURRENT), true)
  assert.equal(needsClickwrapPrompt(CURRENT), false)
  assert.equal(needsClickwrapPrompt({ ...CURRENT, agreementVersion: 'driver-clickwrap-2026-01-01' }), true)
})

test('an older stored version asks again, and the current version does not', async () => {
  const writes = []
  const storage = {
    async getItem() { return 'driver-clickwrap-2026-01-01' },
    async setItem(key, value) { writes.push([key, value]) },
  }
  let fetches = 0
  const phase = await loadDriverClickwrapPhase({
    storage,
    fetchStatus: async () => {
      fetches += 1
      return { accepted: false, requiredVersion: DRIVER_CLICKWRAP_VERSION, acceptance: null }
    },
  })
  assert.equal(phase, 'required')
  assert.equal(fetches, 1)
  assert.equal(writes.length, 0)

  const current = await loadDriverClickwrapPhase({
    storage: {
      async getItem() { return DRIVER_CLICKWRAP_VERSION },
      async setItem() { throw new Error('should not write') },
    },
    fetchStatus: async () => { throw new Error('should not fetch') },
  })
  assert.equal(current, 'ok')
})

test('a server acceptance of this version is remembered for the next launch', async () => {
  const writes = []
  const phase = await loadDriverClickwrapPhase({
    storage: {
      async getItem() { return null },
      async setItem(key, value) { writes.push([key, value]) },
    },
    fetchStatus: async () => ({
      accepted: true,
      requiredVersion: DRIVER_CLICKWRAP_VERSION,
      acceptance: CURRENT,
    }),
  })
  assert.equal(phase, 'ok')
  assert.deepEqual(writes, [[CLICKWRAP_STORAGE_KEY, DRIVER_CLICKWRAP_VERSION]])
})

test('a failed status check keeps the driver on the agreement', async () => {
  const phase = await loadDriverClickwrapPhase({
    storage: { async getItem() { return null }, async setItem() {} },
    fetchStatus: async () => { throw new Error('offline') },
  })
  assert.equal(phase, 'required')
})

test('the clickwrap fine print acknowledges accident responsibility and the TNC limits', () => {
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /you and your automobile insurance carrier\(s\) are solely responsible for any accidents and all resulting liability, including injuries, death, and property damage/i)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /\$50,000 per person/)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /\$100,000 per incident/)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /\$50,000 for property damage/)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /\$1,000,000/)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /uninsured-motorist coverage/)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /standard commercial general liability policy/)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /except as otherwise required by applicable law/i)
  assert.match(DRIVER_CLICKWRAP_SUMMARY, /does not cover a Ride or a Driver or Rider incident, accident, injury, or interaction/)
})

test('the clickwrap links open the Driver Agreement, Terms, and Privacy', () => {
  const agreement = legalDocument('driver-agreement')
  assert.equal(agreement.title, 'Driver Agreement')
  assert.equal(agreement.sections.length, 1)
  assert.match(agreement.sections[0].paragraphs.join(' '), /independent contractor/)
  assert.equal(legalDocument('terms').title, 'Terms of Service')
  assert.equal(legalDocument('privacy').title, 'Privacy Policy')
  assert.throws(() => legalDocument('other'), /Unknown legal document/)
})
