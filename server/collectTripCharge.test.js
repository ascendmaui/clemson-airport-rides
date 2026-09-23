import assert from 'node:assert/strict'
import test from 'node:test'
import { collectMidrideCharge, normalizeChargeOutcome } from './collectTripCharge.js'

const base = {
  amountCents: 1250,
  riderId: 'rider',
  tripId: 'trip-1',
  driverId: 'driver',
  profile: { stripe_customer_id: 'cus', stripe_default_pm_id: 'pm' },
}

test('a declined card becomes payment_required and does not throw', async () => {
  const outcome = await collectMidrideCharge({
    ...base,
    stripe: {
      paymentIntents: {
        create: async () => {
          const err = new Error('Your card was declined')
          err.payment_intent = { id: 'pi_declined' }
          throw err
        },
      },
    },
  }, { collectPayment: null })

  assert.equal(outcome.paymentStatus, 'payment_required')
  assert.equal(outcome.stripePaymentIntentId, 'pi_declined')
  assert.match(outcome.chargeError, /declined/)
})

test('shared collectPayment is used when it is present', async () => {
  let called = false
  const outcome = await collectMidrideCharge(base, {
    collectPayment: async (args) => {
      called = true
      assert.equal(args.kind, 'midride_cancel')
      assert.equal(args.allowCredits, true)
      assert.equal(args.amountCents, 1250)
      return { status: 'covered_by_credits', creditsAppliedCents: 1250 }
    },
  })
  assert.equal(called, true)
  assert.equal(outcome.paymentStatus, 'covered_by_credits')
  assert.equal(outcome.creditsAppliedCents, 1250)
  assert.equal(outcome.chargeError, null)
})

test('a throwing collector still surfaces payment_required', async () => {
  const outcome = await collectMidrideCharge(base, {
    collectPayment: async () => {
      throw new Error('card_declined')
    },
  })
  assert.equal(outcome.paymentStatus, 'payment_required')
  assert.equal(outcome.chargeError, 'card_declined')
  assert.equal(outcome.source, 'collectPayment')
})

test('normalizeChargeOutcome maps failed and needs_card onto payment_required', () => {
  for (const status of ['failed', 'declined', 'needs_card', 'requires_payment_method', 'requires_action']) {
    const outcome = normalizeChargeOutcome({ status, error: status })
    assert.equal(outcome.paymentStatus, 'payment_required')
  }
  assert.equal(normalizeChargeOutcome({ status: 'succeeded', paymentIntentId: 'pi_1' }).paymentStatus, 'succeeded')
})
