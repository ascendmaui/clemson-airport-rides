import assert from 'node:assert/strict'
import test from 'node:test'
import { driverQuizError } from '../shared/driverQuiz.js'

test('student status is optional and a car plus insurance are required', () => {
  assert.equal(driverQuizError({ hasCar: true, hasInsurance: true, attestation: true }), null)
  assert.match(driverQuizError({ hasCar: false, hasInsurance: true, attestation: true }), /car/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: false, attestation: true }), /insurance/i)
  assert.match(driverQuizError({ hasCar: true, hasInsurance: true, attestation: false }), /insurance/i)
  assert.equal(driverQuizError({ hasCar: true, hasInsurance: true, attestation: true, isStudent: false }), null)
})
