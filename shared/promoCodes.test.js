import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  choosePromoOrRecurring,
  describePromo,
  isValidPromoCode,
  looksLikeWeeklyCoupon,
  normalizePromoCode,
  planPromoCodes,
  PROMO_AUTO_DEFAULTS,
  PROMO_AUTO_HEADLINE,
  PROMO_LIMITS,
  promoCodesCsv,
  promoDiscountCents,
  promoTripSnapshot,
  publicCampaignRow,
  riderFareAfterPromoCents,
  tripPromoDiscountCents,
  validatePromoDefinition,
} from './promoCodes.js'
import { WEEKLY_COUPON_CONCEPTS } from './weeklyCoupon.js'

const NOW = new Date('2026-10-15T16:00:00Z')
const inDays = (n) => new Date(NOW.getTime() + n * 86400000).toISOString()

test('normalizes and validates code shape', () => {
  assert.equal(normalizePromoCode(' tiger-25 '), 'TIGER25')
  assert.equal(isValidPromoCode('TIGER25'), true)
  assert.equal(isValidPromoCode('tiger25'), false)
  assert.equal(isValidPromoCode('ABC'), false)
})

test('Friday coupon look-alikes are rejected', () => {
  const prefix = WEEKLY_COUPON_CONCEPTS[0].codePrefix.toUpperCase()
  assert.equal(looksLikeWeeklyCoupon(`${prefix}261016`), true)
  assert.equal(planPromoCodes({ code: `${prefix}261016` }).ok, false)
  assert.equal(looksLikeWeeklyCoupon('FALLFRESH'), false)
})

test('percent rider code gets the default $15 cap; fields map to columns', () => {
  const out = validatePromoDefinition({
    side: 'rider', discountType: 'percent', percentOff: 20, expiresAt: inDays(30),
  }, { now: NOW })
  assert.equal(out.ok, true)
  assert.equal(out.row.percent_off_bps, 2000)
  assert.equal(out.row.max_discount_cents, PROMO_LIMITS.defaultPercentCapCents)
  assert.equal(out.row.per_account_limit, 1)
  assert.equal(out.row.max_redemptions, 1, 'single-use')
  assert.equal(out.row.limit_per_device, true)
  assert.equal(out.row.limit_per_card, true)
  assert.equal(out.row.public_listing, false)
})

test('guardrails reject unsafe definitions', () => {
  const base = { side: 'rider', discountType: 'flat', amountOffCents: 500, expiresAt: inDays(30) }
  const bad = (patch) => validatePromoDefinition({ ...base, ...patch }, { now: NOW })
  assert.equal(bad({}).ok, true)
  assert.equal(bad({ amountOffCents: 5001 }).ok, false)
  assert.equal(bad({ discountType: 'percent', amountOffCents: null, percentOff: 51 }).ok, false)
  assert.equal(bad({ maxRedemptions: 1 }).ok, true)
  assert.match(bad({ maxRedemptions: 100 }).errors.join(), /single-use/)
  assert.match(bad({ perAccountLimit: 2 }).errors.join(), /single-use/)
  assert.equal(bad({ expiresAt: null }).ok, false)
  assert.equal(bad({ expiresAt: inDays(-1) }).ok, false)
  assert.equal(bad({ expiresAt: inDays(400) }).ok, false)
  assert.equal(bad({ side: 'admin' }).ok, false)
})

test('driver codes are flat only, with no trip minimum', () => {
  const base = { side: 'driver', expiresAt: inDays(60) }
  assert.equal(validatePromoDefinition({ ...base, discountType: 'flat', amountOffCents: 2500 }, { now: NOW }).ok, true)
  assert.equal(validatePromoDefinition({ ...base, discountType: 'percent', percentOff: 10 }, { now: NOW }).ok, false)
  assert.equal(validatePromoDefinition({ ...base, discountType: 'flat', amountOffCents: 2500, minTripCents: 1000 }, { now: NOW }).ok, false)
})

test('batch planning: unique, prefixed, bounded', () => {
  let seed = 7
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
  const out = planPromoCodes({ prefix: 'fall', count: 50 }, random)
  assert.equal(out.ok, true)
  assert.equal(out.codes.length, 50)
  assert.equal(new Set(out.codes).size, 50)
  for (const code of out.codes) {
    assert.match(code, /^FALL[A-Z2-9]{6}$/)
    assert.equal(isValidPromoCode(code), true)
  }
  assert.equal(planPromoCodes({ count: PROMO_LIMITS.maxBatch + 1 }).ok, false)
  assert.equal(planPromoCodes({ code: 'bad code!' }).ok, false)
})

test('discount math mirrors the SQL', () => {
  const pct = { discount_type: 'percent', percent_off_bps: 2500, max_discount_cents: 500, min_trip_cents: 1000 }
  assert.equal(promoDiscountCents(pct, 1200), 300)
  assert.equal(promoDiscountCents(pct, 4000), 500)
  assert.equal(promoDiscountCents(pct, 900), 0)
  assert.equal(promoDiscountCents(pct, 900, { enforceMinimum: false }), 225)
  const flat = { discount_type: 'flat', amount_off_cents: 1000 }
  assert.equal(promoDiscountCents(flat, 600), 600, 'never more than the fare')
})

test('no-stack: the rider gets the lower price, and the code is kept when recurring discounts win', () => {
  assert.deepEqual(
    choosePromoOrRecurring({ recurringFareCents: 900, listFareCents: 1000, promoDiscountCents: 300 }),
    { usePromo: true, riderPaysCents: 700, fareCents: 1000 },
  )
  const kept = choosePromoOrRecurring({ recurringFareCents: 900, listFareCents: 1000, promoDiscountCents: 50 })
  assert.equal(kept.usePromo, false)
  assert.equal(kept.reason, 'better_discount_applied')
  assert.equal(kept.riderPaysCents, 900)
  assert.equal(choosePromoOrRecurring({ recurringFareCents: 1000, listFareCents: 1000, promoDiscountCents: 0 }).usePromo, false)
})

test('trip snapshot drives hold and capture; fare_cents (driver basis) is untouched', () => {
  const snapshot = promoTripSnapshot({
    ok: true, redemption_id: 'r1', code: 'FALL20', discount_type: 'percent', percent_off_bps: 2000,
    max_discount_cents: 1500, min_trip_cents: 0, discount_cents: 400,
  }, { listFareCents: 2000, recurringFareCents: 1800 })
  assert.equal(snapshot.funded_by, 'platform')
  assert.equal(snapshot.no_stack, true)
  const trip = { fare_cents: 2000, metadata: { promo: snapshot } }
  assert.equal(tripPromoDiscountCents(trip), 400)
  assert.equal(riderFareAfterPromoCents(trip), 1600)
  assert.equal(tripPromoDiscountCents(trip, 3000), 600, 'final fare drives the capture discount')
  assert.equal(trip.fare_cents, 2000)
  assert.equal(tripPromoDiscountCents({ fare_cents: 2000, metadata: {} }), 0)
  assert.equal(tripPromoDiscountCents({ fare_cents: 2000, metadata: { promo: { code: 'X' } } }), 0, 'needs a redemption id')
})

test('public campaign row exposes no counts or internals', () => {
  const row = publicCampaignRow({
    id: 'secret', code: 'FALL20', side: 'rider', discount_type: 'percent', percent_off_bps: 2000,
    max_discount_cents: 1500, min_trip_cents: 0, starts_at: 'a', expires_at: 'b', notes: 'internal',
    budget_cents: 100000, created_by_email: 'x@example.com',
  })
  assert.equal(row.description, '20% off (up to $15)')
  assert.equal('id' in row, false)
  assert.equal('notes' in row, false)
  assert.equal('budget_cents' in row, false)
  assert.equal('created_by_email' in row, false)
  assert.match(row.terms, /One promo per ride/)
})

test('CSV export escapes and guards against formula injection', () => {
  const csv = promoCodesCsv([{
    code: 'FALL20', side: 'rider', campaign: '=HYPERLINK("x")', discount_type: 'flat', amount_off_cents: 500,
    min_trip_cents: 0, max_redemptions: 1, per_account_limit: 1, active: true, counts: { redeemed: 1 },
  }])
  const [head, line] = csv.trim().split('\n')
  assert.match(head, /^code,source,status,side,campaign,/)
  assert.match(line, /^FALL20,admin,used,rider,"'=HYPERLINK\(""x""\)",\$5 off,flat,,5\.00,/)
  assert.equal(describePromo({ side: 'driver', amount_off_cents: 2500 }), '$25 driver signup bonus')
})

test('auto codes read "50% off your next ride"; a capped one says so', () => {
  const auto = { source: 'auto_card', side: 'rider', discount_type: 'percent', percent_off_bps: 5000, max_discount_cents: null }
  assert.equal(describePromo(auto), '50% off your next ride')
  assert.equal(describePromo({ ...auto, max_discount_cents: 2500 }), '50% off (up to $25)')
  assert.equal(PROMO_AUTO_DEFAULTS.percentOffBps, 5000)
  assert.equal(PROMO_AUTO_DEFAULTS.maxDiscountCents, null, 'no dollar cap by default')
  assert.equal(PROMO_AUTO_DEFAULTS.expiresDays, 90)
  assert.equal(PROMO_AUTO_DEFAULTS.creditThresholdCents, 5000)
  assert.equal(PROMO_AUTO_HEADLINE, '50% off your next ride.')
  assert.equal(PROMO_LIMITS.maxRedemptions, 1)
})

test('uncapped 50% on a long airport fare is the full half (the margin risk to watch)', () => {
  const auto = { discount_type: 'percent', percent_off_bps: 5000, max_discount_cents: null, min_trip_cents: 0 }
  assert.equal(promoDiscountCents(auto, 15200), 7600)
  assert.equal(promoDiscountCents({ ...auto, max_discount_cents: 2500 }, 15200), 2500)
})
