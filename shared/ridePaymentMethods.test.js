import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADD_ANOTHER_PAYMENT_METHOD_ID,
  ADD_ANOTHER_PAYMENT_METHOD_LABEL,
  RIDE_PAYMENT_METHODS,
  buildSetupCheckoutParams,
  buildSetupIntentParams,
  googlePayTestEnv,
  listCustomerPaymentMethods,
  narrowSetupPaymentMethodTypes,
  nativeSetupSheetParams,
  readPublicStripeConfig,
  savedPaymentMethodLabel,
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
  assert.equal(intent.amount, undefined)
})

test('native PaymentSheet uses the SetupIntent types and does not charge', () => {
  const apple = nativeSetupSheetParams('apple_pay')
  assert.deepEqual(apple.applePay, { merchantCountryCode: 'US' })
  assert.equal(apple.googlePay, undefined)
  assert.equal(apple.allowsDelayedPaymentMethods, false)
  assert.deepEqual(apple.paymentMethodOrder, ['card'])
  assert.equal(apple.link.display, 'never')
  assert.equal(apple.primaryButtonLabel, 'Save payment method')

  const cash = nativeSetupSheetParams('cashapp')
  assert.equal(cash.applePay, undefined)
  assert.equal(cash.allowsDelayedPaymentMethods, true)
  assert.deepEqual(cash.paymentMethodOrder, ['cashapp'])

  const card = nativeSetupSheetParams('card')
  assert.equal(card.applePay, undefined)
  assert.equal(card.googlePay, undefined)

  const google = nativeSetupSheetParams('google_pay', { testEnv: false })
  assert.equal(google.applePay, undefined)
  assert.deepEqual(google.googlePay, { merchantCountryCode: 'US', currencyCode: 'USD', testEnv: false })

  const link = nativeSetupSheetParams('link')
  assert.deepEqual(link.paymentMethodOrder, ['link'])
  assert.equal(link.link.display, 'automatic')

  const all = nativeSetupSheetParams(ADD_ANOTHER_PAYMENT_METHOD_ID, { testEnv: true })
  assert.deepEqual(all.applePay, { merchantCountryCode: 'US' })
  assert.equal(all.googlePay.testEnv, true)
  assert.equal(all.allowsDelayedPaymentMethods, true)
  assert.deepEqual(all.paymentMethodOrder, ['card', 'cashapp', 'link'])
  assert.equal(googlePayTestEnv('pk_live_example'), false)
  assert.equal(googlePayTestEnv('pk_test_example'), true)

  const pub = readPublicStripeConfig({
    STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder',
    VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_realkey',
    STRIPE_MERCHANT_IDENTIFIER: 'merchant.com.ascendmaui.clemsonrides',
    EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER: 'not-a-merchant',
  })
  assert.equal(pub.publishableKey, 'pk_test_realkey')
  assert.equal(pub.merchantIdentifier, 'merchant.com.ascendmaui.clemsonrides')
  assert.equal(readPublicStripeConfig({ STRIPE_PUBLISHABLE_KEY: 'sk_test_secret' }).publishableKey, null)
})

test('saved methods are card, Cash App Pay, and Link', async () => {
  const calls = []
  const stripe = {
    paymentMethods: {
      async list({ type }) {
        calls.push(type)
        if (type === 'cashapp') {
          const err = new Error('The payment method type cashapp is invalid')
          throw err
        }
        if (type === 'card') {
          return { data: [{ id: 'pm_card', type: 'card', card: { brand: 'visa', last4: '4242' } }] }
        }
        if (type === 'link') {
          return { data: [{ id: 'pm_link', type: 'link', link: { email: 'a@clemson.edu' } }] }
        }
        return { data: [{ id: 'pm_other', type: 'affirm' }] }
      },
    },
  }
  const methods = await listCustomerPaymentMethods(stripe, 'cus_1')
  assert.deepEqual(calls, ['card', 'cashapp', 'link'])
  assert.equal(savedPaymentMethodLabel(methods[0]), 'VISA ···· 4242')
  assert.equal(savedPaymentMethodLabel(methods[1]), 'Link · a@clemson.edu')
  assert.equal(savedPaymentMethodLabel({ type: 'cashapp', cashtag: '$tiger', brand: 'Cash App' }), 'Cash App $tiger')
  assert.deepEqual(await listCustomerPaymentMethods(stripe, ''), [])
})
