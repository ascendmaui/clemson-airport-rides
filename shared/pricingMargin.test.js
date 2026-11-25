import assert from 'node:assert/strict'
import test from 'node:test'
import { MARGIN_DEFAULTS, driverPayoutCents, fareMargin, minFareForMargin, normalizeMarginSettings, stripeFeeCents } from './pricingMargin.js'

test('defaults: 15% target, Stripe 2.9% + $0.30, $0.75 overhead, 80% driver share', () => {
  assert.equal(MARGIN_DEFAULTS.targetMarginBps, 1500)
  assert.equal(MARGIN_DEFAULTS.stripeFeeBps, 290)
  assert.equal(MARGIN_DEFAULTS.stripeFixedCents, 30)
  assert.equal(MARGIN_DEFAULTS.overheadCents, 75)
  assert.equal(MARGIN_DEFAULTS.driverShareBps, 8000)
})

test('driver payout matches the platform split: fare - round(fare x 20%)', () => {
  assert.equal(driverPayoutCents(590), 472)
  assert.equal(driverPayoutCents(663), 530) // fee round(132.6) = 133
  assert.equal(driverPayoutCents(0), 0)
})

test('Stripe fee is 2.9% rounded plus 30 cents, and zero on a zero charge', () => {
  assert.equal(stripeFeeCents(590), 47) // round(17.11) + 30
  assert.equal(stripeFeeCents(6540), 220) // round(189.66) + 30
  assert.equal(stripeFeeCents(0), 0)
})

test('margin of a $5.90 minimum fare is slightly negative', () => {
  const m = fareMargin({ fareCents: 590 })
  assert.deepEqual(
    { driver: m.driverPayoutCents, stripe: m.stripeFeeCents, overhead: m.overheadCents, profit: m.profitCents },
    { driver: 472, stripe: 47, overhead: 75, profit: -4 },
  )
  assert.equal(m.marginBps, -68)
  assert.equal(m.belowTarget, true)
  assert.equal(m.unprofitable, true)
})

test('margin of the $65.40 GSP fare clears 15%', () => {
  const m = fareMargin({ fareCents: 6540 })
  assert.equal(m.profitCents, 6540 - 5232 - 220 - 75)
  assert.equal(m.belowTarget, false)
})

test('carpool seat: each seat pays its own Stripe fixed fee; overhead per seat unless spread', () => {
  const seat = fareMargin({ fareCents: 295, carpool: true })
  assert.equal(seat.stripeFeeCents, 39) // round(8.555) + 30
  assert.equal(seat.overheadCents, 75)
  assert.equal(seat.profitCents, 295 - 236 - 39 - 75)
  const spread = fareMargin({ fareCents: 295, carpool: true, settings: { carpoolOverheadSeats: 3 } })
  assert.equal(spread.overheadCents, 25)
  assert.ok(spread.profitCents > seat.profitCents)
})

test('an actual offer-ladder payout can be passed in', () => {
  const m = fareMargin({ fareCents: 1000, driverPayout: 700 })
  assert.equal(m.profitCents, 1000 - 700 - 59 - 75)
})

test('min fare for margin: break-even ~$6.14; 15% needs $50; unreachable returns null', () => {
  const breakEven = minFareForMargin({ targetBps: 0 })
  assert.ok(breakEven >= 610 && breakEven <= 620, String(breakEven))
  assert.equal(fareMargin({ fareCents: breakEven, settings: { targetMarginBps: 0 } }).belowTarget, false)
  assert.equal(fareMargin({ fareCents: breakEven - 5, settings: { targetMarginBps: 0 } }).belowTarget, true)
  const fifteen = minFareForMargin()
  assert.equal(fifteen, 5000)
  assert.equal(fareMargin({ fareCents: fifteen }).belowTarget, false)
  assert.equal(minFareForMargin({ targetBps: 1800 }), null, 'share 80% + Stripe 2.9% + 18% > 100%')
})

test('settings are clamped', () => {
  const s = normalizeMarginSettings({ targetMarginBps: -5, stripeFeeBps: 99999, overheadCents: 'x', carpoolOverheadSeats: 0 })
  assert.equal(s.targetMarginBps, 0)
  assert.equal(s.stripeFeeBps, 1000)
  assert.equal(s.overheadCents, 75)
  assert.equal(s.carpoolOverheadSeats, 1)
})
