import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { driverQuizError, driverQuizPayload } from '../shared/driverQuiz.js'

test('student status is optional and a car plus insurance are required', () => {
  assert.equal(driverQuizError({ hasCar: true, hasInsurance: true, attestation: true }), null)
  assert.match(driverQuizError({ hasCar: false, hasInsurance: true, attestation: true }), /car/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: false, attestation: true }), /insurance/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: true, attestation: false }), /insurance/i)
  assert.equal(driverQuizError({ hasCar: true, hasInsurance: true, attestation: true, isStudent: false }), null)
})

test('quiz reports the first incomplete gate and never treats truthy values as acceptance', () => {
  assert.match(driverQuizError(), /car/i)
  assert.match(driverQuizError({ hasCar: true }), /insurance/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: true }), /confirm/i)
  assert.match(driverQuizError({ hasCar: 'yes', hasInsurance: true, attestation: true }), /car/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: 1, attestation: true }), /insurance/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: true, attestation: 'true' }), /confirm/i)
})

test('the web account step keeps student status optional and explains a No', () => {
  const screen = readFileSync(new URL('../src/screens/DriverOnboarding.jsx', import.meta.url), 'utf8')
  assert.match(screen, /Student status is optional/)
  assert.match(screen, /driverQuizError/)
  assert.match(screen, /isStudent: answers\.isStudent === true/)
  assert.doesNotMatch(screen, /Answer Yes to every question/)
})

test('quiz payload serializes only explicit affirmative answers', () => {
  assert.deepEqual(
    driverQuizPayload({
      isStudent: true,
      hasCar: true,
      hasInsurance: true,
      wantsExtraMoney: true,
      attestationAccepted: true,
    }),
    { isStudent: true, hasCar: true, hasInsurance: true, wantsExtraMoney: true, attestationAccepted: true },
  )
  assert.deepEqual(
    driverQuizPayload({ isStudent: 'true', hasCar: 1, hasInsurance: null, wantsExtraMoney: false, attestationAccepted: undefined }),
    { isStudent: false, hasCar: false, hasInsurance: false, wantsExtraMoney: false, attestationAccepted: false },
  )
})
