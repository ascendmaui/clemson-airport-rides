import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cashoutBalanceCents, cashoutBreakdown, cashoutFeeCents, cashoutKeyAllowed, cashoutState,
  isInstantIneligibleError, nyDay, payoutDestination, sweepWindowBlocked,
} from './cashout.js'

test('nyDay uses the America/New_York calendar day across UTC midnight and DST', () => {
  assert.equal(nyDay(new Date('2026-10-13T03:59:00Z')), '2026-10-12') // 11:59 PM EDT
  assert.equal(nyDay(new Date('2026-10-13T04:00:00Z')), '2026-10-13')
  assert.equal(nyDay(new Date('2026-12-01T04:59:00Z')), '2026-11-30') // EST
  assert.equal(nyDay(new Date('2026-12-01T05:00:00Z')), '2026-12-01')
})

test('instant fee is max(min, ceil(1.5%)) and standard is free', () => {
  assert.equal(cashoutFeeCents(1000), 50)
  assert.equal(cashoutFeeCents(10000), 150)
  assert.equal(cashoutFeeCents(10001), 151)
  assert.equal(cashoutFeeCents(10000, { method: 'standard' }), 0)
  assert.equal(cashoutFeeCents(0), 0)
  assert.deepEqual(cashoutBreakdown(12345), { grossCents: 12345, feeCents: 186, netCents: 12159 })
  const b = cashoutBreakdown(7777, { feeBps: 100, feeMinCents: 25 })
  assert.equal(b.grossCents, b.feeCents + b.netCents)
})

test('balance counts only due, non-test trip payouts', () => {
  const trips = [
    { status: 'completed', metadata: { payout: { status: 'pending', amountCents: 4000 } } },
    { status: 'completed', metadata: { payout: { status: 'failed', amountCents: 1200 } } },
    { status: 'cancelled_wait', metadata: { payout: { status: 'pending', amountCents: 160 } } },
    { status: 'completed', metadata: { payout: { status: 'paid', amountCents: 9999 } } },
    { status: 'completed', metadata: { payout: { status: 'cashout_pending', amountCents: 9999 } } },
    { status: 'completed', metadata: { e2e_test: true, payout: { status: 'pending', amountCents: 9999 } } },
    { status: 'canceled', metadata: { payout: { status: 'pending', amountCents: 9999 } } },
  ]
  assert.equal(cashoutBalanceCents(trips), 5360)
})

test('destination prefers an instant debit card, else standard fallback, else setup', () => {
  assert.equal(payoutDestination([{ object: 'card', available_payout_methods: ['standard', 'instant'], last4: '4242' }]).method, 'instant')
  const bank = payoutDestination([{ object: 'bank_account', last4: '6789' }])
  assert.equal(bank.method, 'standard')
  assert.equal(bank.fallbackReason, 'instant_ineligible')
  assert.equal(payoutDestination([]), null)
})

test('cashoutState covers setup, already, zero, below fee, ready', () => {
  const dest = { method: 'instant' }
  assert.equal(cashoutState({ connectAccountId: null, destination: dest, balanceCents: 500 }).state, 'needs_setup')
  assert.equal(cashoutState({ connectAccountId: 'acct', destination: null, balanceCents: 500 }).state, 'needs_setup')
  assert.equal(cashoutState({ connectAccountId: 'acct', destination: dest, balanceCents: 500, cashedOutToday: true }).state, 'already_today')
  assert.equal(cashoutState({ connectAccountId: 'acct', destination: dest, balanceCents: 0 }).state, 'zero_balance')
  assert.equal(cashoutState({ connectAccountId: 'acct', destination: dest, balanceCents: 40 }).state, 'below_fee')
  const ready = cashoutState({ connectAccountId: 'acct', destination: dest, balanceCents: 5000 })
  assert.deepEqual([ready.state, ready.feeCents, ready.netCents], ['ready', 75, 4925])
})

test('instant-ineligible errors trigger fallback; others do not', () => {
  assert.ok(isInstantIneligibleError({ code: 'instant_payouts_unsupported' }))
  assert.ok(isInstantIneligibleError({ message: 'This card is not eligible for instant payouts' }))
  assert.ok(!isInstantIneligibleError({ message: 'Insufficient funds' }))
})

test('live keys are refused unless CASHOUT_LIVE_ENABLED=1', () => {
  assert.ok(cashoutKeyAllowed('sk_test_abc'))
  assert.ok(!cashoutKeyAllowed('sk_live_abc'))
  assert.ok(cashoutKeyAllowed('sk_live_abc', { CASHOUT_LIVE_ENABLED: '1' }))
  assert.ok(!cashoutKeyAllowed(''))
})

test('sweep window pauses 11:50-12:30 UTC', () => {
  assert.ok(sweepWindowBlocked(new Date('2026-10-12T12:00:00Z')))
  assert.ok(!sweepWindowBlocked(new Date('2026-10-12T12:30:00Z')))
  assert.ok(!sweepWindowBlocked(new Date('2026-10-12T11:49:00Z')))
})
