import assert from 'node:assert/strict'
import test from 'node:test'
import { DRIVER_APPLICATION_HREF, openDriverApplication } from './openApplication.ts'

test('tapping Open application navigates to the driver application', () => {
  const pushed = []
  const route = openDriverApplication({
    push(href) {
      pushed.push(href)
    },
  })
  assert.equal(route, '/onboarding')
  assert.equal(DRIVER_APPLICATION_HREF, '/onboarding')
  assert.deepEqual(pushed, ['/onboarding'])
})

test('tapping Open application reports an error instead of doing nothing', () => {
  assert.throws(() => openDriverApplication(null), /Could not open the driver application/)
  assert.throws(() => openDriverApplication({}), /Could not open the driver application/)
})
