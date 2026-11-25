import assert from 'node:assert/strict'
import test from 'node:test'
import { clientErrorMessage } from './clientError.js'

test('clientErrorMessage keeps a short rider-facing sentence', () => {
  assert.equal(clientErrorMessage(new Error('Sign in required'), 'fallback'), 'Sign in required')
  assert.equal(clientErrorMessage('timeout', 'fallback'), 'timeout')
})

test('clientErrorMessage hides stacks, schema text, and secrets', () => {
  const stack = new Error('apply blew up\n    at apply (api/stripe-webhook.js:12:3)')
  assert.equal(clientErrorMessage(stack, 'Webhook error'), 'Webhook error')
  assert.equal(
    clientErrorMessage({ message: 'Could not find the table public.trips in the schema cache' }, 'Could not load'),
    'Could not load',
  )
  assert.equal(clientErrorMessage(new Error('null value in column "email" violates not-null'), 'Could not save'), 'Could not save')
  assert.equal(clientErrorMessage('bad sk_test_secret', 'Webhook error'), 'Webhook error')
  assert.equal(
    clientErrorMessage("Expected property name or '}' in JSON at position 1 (line 1 column 2)", 'Webhook error'),
    "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
  )
  assert.equal(clientErrorMessage('', 'fallback'), 'fallback')
  assert.equal(clientErrorMessage(null, 'fallback'), 'fallback')
})
