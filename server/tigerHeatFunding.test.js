import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maxAffordableBonusCents,
  resolveTigerHeatConfig,
  settleDecoupledFare,
  throttleBonus,
} from './tigerHeatFunding.js'

const OPEN_BOOKS = { revenueCents: 0, driverPayCents: 0, marginCents: 0 }

test('rider fare and driver pay stay separate, and a surplus waives the platform fee', () => {
  const normal = settleDecoupledFare({ riderFareCents: 1798, bonusCents: 0 })
  assert.equal(normal.riderFareCents, 1798)
  assert.equal(normal.driverBaseCents, 1438)
  assert.equal(normal.platformFeeCents, 360)
  assert.equal(normal.platformFeeWaived, false)
  assert.equal(normal.costToPlatformCents, 0)

  // John's Oct 4 Lyft receipt shape: rider $17.98, driver $27.45.
  // $11.67 is the flat incentive stack (Turbo analog + time). The cash gap
  // after the rider fare is $9.47, and the platform fee on that ride is $0.
  const receipt = settleDecoupledFare({
    riderFareCents: 1798,
    driverBaseCents: 1578,
    bonusCents: 1167,
  })
  assert.equal(receipt.riderFareCents, 1798)
  assert.equal(receipt.driverEarningsCents, 2745)
  assert.equal(receipt.bonusCents, 1167)
  assert.equal(receipt.platformFeeCents, 0)
  assert.equal(receipt.platformFeeWaived, true)
  assert.equal(receipt.costToPlatformCents, 947)
  assert.equal(receipt.platformFundedCents, 947)
})

test('default solvency floor is 5 percent, with env and admin overrides', () => {
  const previousBps = process.env.TIGER_HEAT_MIN_MARGIN_BPS
  const previousCents = process.env.TIGER_HEAT_MIN_MARGIN_CENTS
  delete process.env.TIGER_HEAT_MIN_MARGIN_BPS
  delete process.env.TIGER_HEAT_MIN_MARGIN_CENTS
  assert.equal(resolveTigerHeatConfig({}).minMarginBps, 500)
  assert.equal(resolveTigerHeatConfig({}).minMarginCents, 0)

  process.env.TIGER_HEAT_MIN_MARGIN_BPS = '0'
  process.env.TIGER_HEAT_MIN_MARGIN_CENTS = '2500'
  assert.equal(resolveTigerHeatConfig(process.env, null).minMarginBps, 0)
  assert.equal(resolveTigerHeatConfig(process.env, null).minMarginCents, 2500)
  const admin = resolveTigerHeatConfig(process.env, { min_margin_bps: 800, min_margin_cents: 100 })
  assert.equal(admin.minMarginBps, 800)
  assert.equal(admin.minMarginCents, 100)

  if (previousBps == null) delete process.env.TIGER_HEAT_MIN_MARGIN_BPS
  else process.env.TIGER_HEAT_MIN_MARGIN_BPS = previousBps
  if (previousCents == null) delete process.env.TIGER_HEAT_MIN_MARGIN_CENTS
  else process.env.TIGER_HEAT_MIN_MARGIN_CENTS = previousCents
})

test('an empty ledger cannot fund a $20 bonus on an $17.98 fare', () => {
  const config = resolveTigerHeatConfig({})
  const room = maxAffordableBonusCents({
    ledger: OPEN_BOOKS,
    config,
    riderFareCents: 1798,
  })
  assert.ok(room < 1000)
  const decision = throttleBonus({
    requestedCents: 2000,
    ledger: OPEN_BOOKS,
    config,
    riderFareCents: 1798,
    zoneId: 'college-ave-core',
    stage: 'test',
  })
  assert.equal(decision.throttled, true)
  assert.equal(decision.grantedCents, room)
  assert.ok(decision.grantedCents >= 0)
})

test('accumulated margin allows the full flat bonus', () => {
  const config = { minMarginCents: 0, minMarginBps: 500, insuranceBps: 0, taxBps: 0, referenceFareCents: 1798 }
  const decision = throttleBonus({
    requestedCents: 2000,
    ledger: { revenueCents: 200000, driverPayCents: 100000, marginCents: 100000 },
    config,
    riderFareCents: 1798,
    stage: 'test',
  })
  assert.equal(decision.throttled, false)
  assert.equal(decision.grantedCents, 2000)
})
