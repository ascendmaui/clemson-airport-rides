import assert from 'node:assert/strict'
import test from 'node:test'
import { GENERIC_ERROR_COPY } from '../../packages/rides-native/apiErrors.js'
import { requestFailureMessage } from './requestFailure.js'

test('requestFailureMessage prefers a clean server sentence', () => {
  assert.equal(
    requestFailureMessage({
      message: GENERIC_ERROR_COPY,
      payload: { error: 'No approved drivers are online right now.' },
    }),
    'No approved drivers are online right now.',
  )
  assert.equal(
    requestFailureMessage({ message: 'That driver is not approved to receive rides yet.' }),
    'That driver is not approved to receive rides yet.',
  )
  assert.equal(
    requestFailureMessage({ message: 'TypeError: boom', payload: { error: 'card_declined' } }),
    'Could not request that driver',
  )
})
