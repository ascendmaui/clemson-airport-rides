import assert from 'node:assert/strict'
import test from 'node:test'
import { FARE_CARD } from '../src/lib/fareRates.js'
import { COMPETITOR_RATES } from './data/competitorRates.js'
import {
  CLEMSON_BASKET,
  compareBasket,
  competitorFareCents,
  meteredCents,
  ourFareCents,
  planCompetitorApply,
  planMinFare,
} from './pricingCompare.js'

const STD = { baseCents: 119, bookingFeeCents: 265, perMileCents: 114, perMinuteCents: 18, minFareCents: 590 }
const GSP = CLEMSON_BASKET.find((t) => t.id === 'clemson_gsp')
const SHORT = CLEMSON_BASKET.find((t) => t.id === 'short_hop')
// Easy-to-beat competitor: double our card.
const PRICEY = [
  { competitor: 'uber', tier: 'uberx', ourTier: 'standard', baseCents: 238, bookingFeeCents: 530, perMileCents: 228, perMinuteCents: 36, minFareCents: 1180, minIncludesBooking: true },
  { competitor: 'uber', tier: 'uber_comfort', ourTier: 'comfort', baseCents: 400, bookingFeeCents: 800, perMileCents: 400, perMinuteCents: 60, minFareCents: 2000, minIncludesBooking: true },
]
const NO_MARGIN = { margin: { targetMarginBps: 0, overheadCents: 0 } }

test('basket is the five Clemson trips John named', () => {
  assert.deepEqual(CLEMSON_BASKET.map((t) => t.miles), [0.8, 1.5, 3, 30, 45])
})

test('our fare mirrors the engine: metered with the minimum, tier scale, carpool 50%', () => {
  assert.equal(meteredCents(STD, SHORT), 590)
  assert.equal(meteredCents(STD, GSP), 119 + 265 + 5130 + 1026)
  assert.equal(ourFareCents({ cards: { standard: STD }, tier: 'carpool', trip: GSP }), Math.round(6540 * 0.5))
  assert.equal(ourFareCents({ cards: { standard: STD }, tier: 'comfort', trip: GSP }), Math.round(6540 * 1.4))
  assert.equal(ourFareCents({ cards: { standard: STD }, tier: 'standard', trip: GSP, surge: 1.25 }), Math.round(6540 * 1.25))
})

test('in-repo card equals the seed used by the migration', () => {
  for (const k of Object.keys(STD)) assert.equal(FARE_CARD[k], STD[k], k)
})

test('competitor math: Uber minimum is all-in; Lyft adds the service fee on top', () => {
  const uber = COMPETITOR_RATES.find((c) => c.tier === 'uberx')
  const lyft = COMPETITOR_RATES.find((c) => c.tier === 'lyft_standard')
  assert.equal(competitorFareCents(uber, SHORT), 590)
  assert.equal(competitorFareCents(lyft, SHORT), 307 + 325) // ride 2.39 < 3.07 minimum, fee on top
  assert.equal(competitorFareCents(lyft, GSP), 80 + 5130 + 969 + 325)
  assert.equal(competitorFareCents({ ...lyft, minFareCents: 1000 }, SHORT), 1000 + 325)
})

test('percent difference is vs the cheaper competitor', () => {
  const rows = compareBasket({ cards: { standard: STD }, competitors: COMPETITOR_RATES, tiers: ['standard'] })
  const gsp = rows.find((r) => r.trip === 'clemson_gsp')
  const cheapest = Math.min(...gsp.competitors.map((c) => c.fareCents))
  assert.equal(gsp.cheapest.fareCents, cheapest)
  assert.equal(gsp.diffBps, Math.round(((gsp.ourCents - cheapest) * 10000) / cheapest))
  assert.equal(gsp.targetCents, Math.floor(cheapest * 0.97))
  assert.equal(gsp.meetsUndercut, gsp.ourCents <= gsp.targetCents)
})

test('nothing to do when already 3% under: no change, no alert', () => {
  const plan = planCompetitorApply({ cards: { standard: STD }, competitors: PRICEY, settings: NO_MARGIN })
  assert.equal(plan.needed, false)
  assert.equal(plan.ok, false)
  assert.deepEqual(plan.changes, [])
  assert.deepEqual(plan.alerts, [])
})

test('apply lowers rates until every trip is >= 3% under the cheaper competitor', () => {
  const comps = [{ competitor: 'uber', tier: 'uberx', ourTier: 'standard', ...STD, minFareCents: 600, minIncludesBooking: true }]
  const plan = planCompetitorApply({ cards: { standard: { ...STD, perMileCents: 150, minFareCents: 700 } }, competitors: comps, settings: NO_MARGIN })
  assert.equal(plan.ok, true, JSON.stringify(plan.alerts))
  const after = plan.after.standard
  for (const r of compareBasket({ cards: plan.after, competitors: comps, tiers: ['standard'], settings: NO_MARGIN })) {
    assert.equal(r.meetsUndercut, true, r.trip)
  }
  assert.ok(after.perMileCents < 150 && after.perMileCents >= 90)
  assert.ok(after.minFareCents < 700 && after.minFareCents >= 500)
})

test('floor blocks the change: nothing applied, floor alert', () => {
  const cheap = [{ competitor: 'lyft', tier: 'lyft_standard', ourTier: 'standard', baseCents: 0, bookingFeeCents: 0, perMileCents: 50, perMinuteCents: 5, minFareCents: 300, minIncludesBooking: true }]
  const plan = planCompetitorApply({ cards: { standard: STD }, competitors: cheap, settings: NO_MARGIN })
  assert.equal(plan.ok, false)
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.after, plan.before)
  const alert = plan.alerts.find((a) => a.kind === 'floor_blocks_undercut')
  assert.ok(alert)
  assert.ok(alert.floorsHit.length > 0)
})

test('floors never let a proposed card go under $0.90/mi, $0.18/min, $5 minimum', () => {
  const comps = [{ competitor: 'uber', tier: 'uberx', ourTier: 'standard', baseCents: 50, bookingFeeCents: 100, perMileCents: 95, perMinuteCents: 18, minFareCents: 520, minIncludesBooking: true }]
  const plan = planCompetitorApply({ cards: { standard: STD }, competitors: comps, settings: NO_MARGIN })
  for (const c of plan.proposed) {
    assert.ok(c.after.perMileCents >= 90)
    assert.ok(c.after.perMinuteCents >= 18)
    assert.ok(c.after.minFareCents >= 500)
  }
})

test('margin gate: undercut that breaks the target margin is not applied and alerts', () => {
  const plan = planCompetitorApply({ cards: { standard: STD }, competitors: COMPETITOR_RATES })
  assert.equal(plan.ok, false)
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.after, plan.before)
  const alert = plan.alerts.find((a) => a.kind === 'margin_blocks_undercut')
  assert.ok(alert, JSON.stringify(plan.alerts))
  assert.ok(alert.trips.some((t) => t.tier === 'carpool'), 'carpool per seat is checked')
  assert.ok(alert.trips.every((t) => typeof t.gameDayMarginBps === 'number'), 'game-day version is checked')
})

test('margin gate also checks the game-day 1.25x fares', () => {
  const rows = compareBasket({ cards: { standard: STD }, competitors: COMPETITOR_RATES, tiers: ['standard'] })
  const gsp = rows.find((r) => r.trip === 'clemson_gsp')
  assert.equal(gsp.ourGameDayCents, Math.round(gsp.ourCents * 1.25))
  assert.ok(gsp.gameDayMargin.marginBps > gsp.margin.marginBps)
})

test('min fare: 15% needs $50 per charge, which breaks the competitor rule, so it alerts', () => {
  const plan = planMinFare({ cards: { standard: STD }, competitors: COMPETITOR_RATES })
  assert.equal(plan.ok, false)
  assert.deepEqual(plan.changes, [])
  const std = plan.tiers.find((t) => t.tier === 'standard')
  assert.equal(std.effectiveMinCents, 590)
  assert.equal(std.neededMinCents, 5000)
  assert.ok(plan.alerts.every((a) => a.kind === 'min_fare_breaks_undercut'))
})

test('min fare: break-even target raises the minimum only when it stays under competitors', () => {
  const plan = planMinFare({ cards: { standard: STD }, competitors: PRICEY, settings: { margin: { targetMarginBps: 0 } } })
  assert.equal(plan.ok, true, JSON.stringify(plan.alerts))
  // Carpool per seat needs $6.15, i.e. a Standard minimum of $12.30.
  assert.deepEqual(plan.changes, [{ tier: 'standard', field: 'minFareCents', before: 590, after: 1230 }])
  const tight = planMinFare({ cards: { standard: STD }, competitors: COMPETITOR_RATES, settings: { margin: { targetMarginBps: 0 } } })
  assert.equal(tight.ok, false)
  assert.ok(tight.alerts.some((a) => a.tier === 'standard'))
})
