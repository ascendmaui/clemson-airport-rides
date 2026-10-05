import test from 'node:test'
import assert from 'node:assert/strict'
import { findPrepaidTier, prepaidCreditsFromPayload, prepaidPurchaseSummary } from './prepaidTiers.js'

test('credits_50 confirmation names the credit, the bonus, and the amount Stripe charges', () => {
  const summary = prepaidPurchaseSummary(findPrepaidTier('credits_50'))
  assert.equal(summary.creditCents, 5000)
  assert.equal(summary.bonusCents, 200)
  assert.equal(summary.chargedCents, 5000)
  assert.equal(summary.grantedCents, 5200)
  assert.equal(
    summary.body,
    'Add $50.00 in credits plus a $2.00 bonus ($52.00 in credits). Total charged: $50.00.',
  )
  assert.equal(summary.confirmLabel, 'Charge $50.00')
  assert.equal(summary.cancelLabel, 'Cancel')
  assert.doesNotMatch(summary.body, /Total charged: \$52\.00/)
})

test('credits_100 confirmation uses the tier price as the charge', () => {
  const summary = prepaidPurchaseSummary(findPrepaidTier('credits_100'))
  assert.equal(summary.body, 'Add $100.00 in credits plus a $10.00 bonus ($110.00 in credits). Total charged: $100.00.')
})

test('a pack with no bonus still states a $0.00 bonus and the charge', () => {
  const summary = prepaidPurchaseSummary(findPrepaidTier('credits_25'))
  assert.equal(summary.bonusCents, 0)
  assert.match(summary.body, /plus a \$0\.00 bonus/)
  assert.match(summary.body, /Total charged: \$25\.00/)
})

test('prepaid ledger payload does not turn an unavailable wallet into $0', () => {
  assert.deepEqual(prepaidCreditsFromPayload({ balanceCents: 0, unavailable: true, tiers: [] }), {
    balanceCents: null,
    unavailable: true,
    tiers: [],
  })
  assert.deepEqual(prepaidCreditsFromPayload({ balanceCents: 5200, unavailable: false }), {
    balanceCents: 5200,
    unavailable: false,
    tiers: [],
  })
  assert.equal(prepaidCreditsFromPayload({ balanceCents: 0, unavailable: false }).balanceCents, 0)
})
