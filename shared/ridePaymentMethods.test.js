import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADD_ANOTHER_PAYMENT_METHOD_ID,
  ADD_ANOTHER_PAYMENT_METHOD_LABEL,
  RIDE_PAYMENT_METHODS,
  buildSetupCheckoutParams,
  buildSetupIntentParams,
  narrowSetupPaymentMethodTypes,
  setupPaymentMethodTypes,
} from './ridePaymentMethods.js'

const EXCLUDED = [
  'affirm',
  'afterpay_clearpay',
  'klarna',
  'zip',
  'us_bank_account',
  'sepa_debit',
  'acss_debit',
  'customer_balance',
  'crypto',
  'paypal',
  'amazon_pay',
]

test('the rideshare picker lists Card, Cash App Pay, Apple Pay, Google Pay, and Link', () => {
  assert.deepEqual(
    RIDE_PAYMENT_METHODS.map((method) => method.label),
    ['Card', 'Cash App Pay', 'Apple Pay', 'Google Pay', 'Link'],
  )
  assert.deepEqual(
    RIDE_PAYMENT_METHODS.map((method) => method.id),
    ['card', 'cashapp', 'apple_pay', 'google_pay', 'link'],
  )
  assert.equal(ADD_ANOTHER_PAYMENT_METHOD_LABEL, 'Add another payment method')
  for (const excluded of EXCLUDED) {
    assert.equal(RIDE_PAYMENT_METHODS.some((method) => method.id === excluded || method.stripeType === excluded), false)
  }
})

test('Apple Pay and Google Pay save as card wallets; Cash App Pay and Link use their Stripe types', () => {
  assert.deepEqual(setupPaymentMethodTypes('apple_pay'), ['card'])
  assert.deepEqual(setupPaymentMethodTypes('google_pay'), ['card'])
  assert.deepEqual(setupPaymentMethodTypes('cashapp'), ['cashapp'])
  assert.deepEqual(setupPaymentMethodTypes('link'), ['link'])
  assert.deepEqual(setupPaymentMethodTypes('card'), ['card'])
  assert.deepEqual(setupPaymentMethodTypes(ADD_ANOTHER_PAYMENT_METHOD_ID), ['card', 'cashapp', 'link'])
})

test('a rejected extra type is dropped only when several types were requested', () => {
  assert.deepEqual(
    narrowSetupPaymentMethodTypes(['card', 'cashapp', 'link'], 'The payment method type cashapp is invalid'),
    ['card', 'link'],
  )
  assert.equal(
    narrowSetupPaymentMethodTypes(['cashapp'], 'The payment method type cashapp is invalid'),
    null,
  )
  assert.equal(narrowSetupPaymentMethodTypes(['card', 'link'], 'network down'), null)
})

test('setup checkout collects a payment method and does not create a charge', () => {
  const params = buildSetupCheckoutParams({
    customerId: 'cus_1',
    userId: 'user_1',
    paymentMethod: 'apple_pay',
    types: ['card'],
    returnUrl: 'https://evil.example/phish',
  })
  assert.equal(params.mode, 'setup')
  assert.equal(params.payment_method_types.join(','), 'card')
  assert.equal(params.line_items, undefined)
  assert.match(params.success_url, /^clemsonrides:\/\/billing\?setup=1&session_id=\{CHECKOUT_SESSION_ID\}/)
  assert.match(params.cancel_url, /redirect_status=canceled/)

  const intent = buildSetupIntentParams({
    customerId: 'cus_1',
    userId: 'user_1',
    paymentMethod: 'link',
    types: ['link'],
  })
  assert.equal(intent.usage, 'off_session')
  assert.deepEqual(intent.payment_method_types, ['link'])
  assert.equal(intent.automatic_payment_methods, undefined)
})
