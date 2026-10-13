import assert from 'node:assert/strict'
import test from 'node:test'
import { assertRiderPaymentMethod } from './ridePaymentGate.js'

function profileSb(profile, { error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, 'profiles')
      const api = {
        select() { return api },
        eq(col, val) {
          assert.equal(col, 'id')
          assert.equal(val, 'rider-1')
          return api
        },
        maybeSingle: async () => ({ data: profile, error }),
      }
      return api
    },
  }
}

test('ride requests require a saved card or Apple Pay', async () => {
  const missing = await assertRiderPaymentMethod(profileSb(null), 'rider-1', {})
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 402)
  assert.equal(missing.code, 'payment_method_required')

  const card = await assertRiderPaymentMethod(profileSb({ stripe_default_pm_id: 'pm_card' }), 'rider-1', {})
  assert.deepEqual(card, { ok: true, source: 'default' })

  const apple = await assertRiderPaymentMethod(profileSb({ stripe_card_brand: 'visa' }), 'rider-1', { applePay: true })
  assert.deepEqual(apple, { ok: true, source: 'apple_pay' })

  const wallet = await assertRiderPaymentMethod(profileSb(null), 'rider-1', { paymentMethod: 'apple_pay' })
  assert.equal(wallet.ok, true)

  const lookup = await assertRiderPaymentMethod(profileSb(null, { error: { message: 'timeout' } }), 'rider-1', {})
  assert.equal(lookup.status, 503)
  assert.equal(lookup.code, 'payment_method_lookup_failed')
})
