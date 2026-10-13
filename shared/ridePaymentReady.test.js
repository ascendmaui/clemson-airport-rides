import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAYMENT_METHOD_REQUIRED,
  paymentMethodRequiredError,
  riderPaymentMethodReady,
} from './ridePaymentReady.js'

test('a saved card or Apple Pay is enough to request a ride', () => {
  assert.deepEqual(riderPaymentMethodReady(null), { ok: false, source: null })
  assert.deepEqual(riderPaymentMethodReady({}), { ok: false, source: null })
  assert.deepEqual(riderPaymentMethodReady({ stripe_default_pm_id: 'pm_card' }), { ok: true, source: 'default' })
  assert.deepEqual(riderPaymentMethodReady({ stripe_card_brand: 'apple_pay' }), { ok: true, source: 'apple_pay' })
  assert.deepEqual(riderPaymentMethodReady({}, { applePay: true }), { ok: true, source: 'apple_pay' })
  assert.equal(riderPaymentMethodReady({ stripe_default_pm_id: 'pm_card' }, { applePay: true }).source, 'default')
  assert.equal(paymentMethodRequiredError({ code: PAYMENT_METHOD_REQUIRED }), true)
  assert.equal(paymentMethodRequiredError({ code: 'card_declined' }), false)
  assert.equal(paymentMethodRequiredError(null), false)
})
