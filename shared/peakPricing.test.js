import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PEAK_DEFAULTS,
  baseFareFromCharged,
  checkPeakGuardrails,
  detectPeak,
  gameDayWindow,
  isAirportRush,
  isWeekendNight,
  normalizePeakConfig,
  peakBonusCents,
  peakDriverCut,
  peakDriverLine,
  peakRiderLine,
  planPeakTrip,
  poolContributionCents,
  scheduledGameAt,
  surchargeBpsFor,
  surchargeForFare,
} from './peakPricing.js'
import { CLEMSON_HOME_FOOTBALL } from './data/clemsonHomeFootball.js'

// Times are UTC; Clemson is EDT (UTC-4) in October.
const CSU_KICKOFF = new Date('2026-10-17T16:00:00Z') // Sat Oct 17, 12:00 ET
const THURSDAY_NOON = new Date('2026-10-15T16:00:00Z')
const ALL_REASONS_ON = { reasonBps: { game_day: 5000, airport_rush: 1000, weekend_night: 1000 } }

test('defaults follow the research recommendation', () => {
  const c = normalizePeakConfig(null)
  assert.equal(c.reasonBps.game_day, 5000)
  assert.equal(c.reasonBps.airport_rush, 1000)
  assert.equal(c.reasonBps.weekend_night, 0)
  assert.equal(c.maxSurchargeBps, 7500)
  assert.equal(c.surgeScheduled, false)
  assert.equal(c.driverPayBasis, 'pre_discount')
  assert.equal(c.baseShareBps, 8000)
})

test('config overrides are clamped to safe values', () => {
  const c = normalizePeakConfig({ surchargeDriverShareBps: 5000, maxSurchargeBps: 2000, reasonBps: { game_day: 9000 }, targetUpliftBps: 9000, poolContributionBps: 5000 })
  assert.equal(c.surchargeDriverShareBps, c.baseShareBps, 'driver share of the surcharge is never below the base share')
  assert.equal(c.reasonBps.game_day, 2000, 'reason held under the cap')
  assert.equal(c.targetUpliftBps, c.bandCeilingBps, 'target held inside the 25-50% band')
  assert.equal(c.poolContributionBps, 1000, 'contribution held at 10% max')
})

test('game day comes from the schedule file, not every fall Saturday', () => {
  assert.equal(scheduledGameAt(CSU_KICKOFF)?.opponent, 'Charleston Southern')
  const w = gameDayWindow({ date: '2026-10-17', kickoffEt: '12:00' })
  assert.equal(new Date(w.startMs).toISOString(), '2026-10-17T13:00:00.000Z') // 09:00 ET
  assert.equal(new Date(w.endMs).toISOString(), '2026-10-17T22:20:00.000Z') // 18:20 ET
  // Open date Saturday Oct 10: no game, no game-day surge (the legacy fallback would fire).
  assert.equal(detectPeak({ at: new Date('2026-10-10T18:00:00Z') }).active, false)
  // TBA kickoff uses 10:00-24:00 ET.
  assert.ok(scheduledGameAt(new Date('2026-11-14T15:00:00Z')))
  assert.equal(scheduledGameAt(new Date('2026-11-14T13:00:00Z')), null)
  // A live game_day_events row also counts.
  assert.equal(detectPeak({ at: THURSDAY_NOON, gameDayEventActive: true }).primary.id, 'game_day')
  assert.equal(CLEMSON_HOME_FOOTBALL.length, 7)
})

test('weekend nights wrap past midnight and are 0% by default', () => {
  assert.equal(isWeekendNight(new Date('2026-10-17T02:30:00Z'), PEAK_DEFAULTS), true) // Fri 22:30 ET
  assert.equal(isWeekendNight(new Date('2026-10-18T05:30:00Z'), PEAK_DEFAULTS), true) // Sun 01:30 ET = Sat night
  assert.equal(isWeekendNight(new Date('2026-10-18T06:30:00Z'), PEAK_DEFAULTS), false) // Sun 02:30 ET
  assert.equal(isWeekendNight(new Date('2026-10-16T02:30:00Z'), PEAK_DEFAULTS), false) // Thu 22:30 ET
  const peak = detectPeak({ at: new Date('2026-10-18T05:30:00Z') })
  assert.equal(peak.active, false, 'detected but 0% means no surcharge')
  assert.equal(peak.reasons[0].id, 'weekend_night')
  assert.equal(detectPeak({ at: new Date('2026-10-18T05:30:00Z'), config: ALL_REASONS_ON }).active, true)
})

test('airport rush only on on-demand airport trips', () => {
  const rush = new Date('2026-10-15T20:00:00Z') // Thu 16:00 ET
  assert.equal(isAirportRush(rush, 'GSP', PEAK_DEFAULTS), true)
  assert.equal(isAirportRush(rush, false, PEAK_DEFAULTS), false)
  assert.equal(detectPeak({ at: rush, airport: 'GSP' }).primary.id, 'airport_rush')
  const scheduled = detectPeak({ at: rush, airport: 'GSP', scheduled: true })
  assert.equal(scheduled.active, false)
  assert.equal(scheduled.scheduledExempt, true)
})

test('surcharge percent: highest reason wins, no stacking, capped', () => {
  const both = detectPeak({ at: new Date('2026-10-17T15:00:00Z'), airport: 'GSP', config: { ...ALL_REASONS_ON, airportRush: [{ startMin: 0, endMin: 1440 }] } })
  assert.deepEqual(both.reasons.map((r) => r.id), ['game_day', 'airport_rush'])
  assert.equal(surchargeBpsFor(both), 5000)
  assert.equal(surchargeBpsFor({ active: true, reasons: [{ bps: 9999 }] }), 7500)
  assert.equal(surchargeBpsFor({ active: false, reasons: [] }), 0)
})

test('surcharge cents: percent then a $25 dollar cap', () => {
  assert.deepEqual(surchargeForFare(590, 5000), { baseFareCents: 590, requestedBps: 5000, surchargeCents: 295, effectiveBps: 5000, dollarCapped: false })
  const gsp = surchargeForFare(6973, 5000)
  assert.equal(gsp.surchargeCents, 2500)
  assert.equal(gsp.dollarCapped, true)
  assert.equal(gsp.effectiveBps, 3585)
  assert.equal(surchargeForFare(6973, 1000).surchargeCents, 697)
})

test('driver cut scales up with the surcharge and stays inside the band ceiling', () => {
  const airport = peakDriverCut({ baseFareCents: 6973, riderFareCents: 7670 })
  assert.equal(airport.offPeakPayCents, 5578)
  assert.equal(airport.surchargeToDriverCents, 627) // floor(0.9 x 697)
  assert.equal(airport.payCents, 6205)
  assert.ok(airport.cutBps > 8000, 'higher cut than 80%')
  // Game day 1.5x on a campus minimum: 90% of the surcharge would be +56%, so the band caps it at +50%.
  const campus = peakDriverCut({ baseFareCents: 590, riderFareCents: 885 })
  assert.equal(campus.offPeakPayCents, 472)
  assert.equal(campus.payCents, 708)
  assert.equal(campus.cutCapped, 'band')
  // Driver never gets more surcharge than the rider paid (heavy discounts).
  const discounted = peakDriverCut({ baseFareCents: 400, riderFareCents: 440, payBaseCents: 590, payPeakCents: 649 })
  assert.equal(discounted.surchargeToDriverCents, 40)
})

test('pool contribution comes only from regular rides and pauses at the ceiling', () => {
  assert.equal(poolContributionCents({ fareCents: 6973 }), 139)
  assert.equal(poolContributionCents({ fareCents: 590 }), 11)
  assert.equal(poolContributionCents({ fareCents: 6973, peak: true }), 0)
  assert.equal(poolContributionCents({ fareCents: 6973, poolBalanceCents: 99_950 }), 50)
  assert.equal(poolContributionCents({ fareCents: 6973, poolBalanceCents: 100_000 }), 0)
})

test('bonus fills only the gap to the target, modest and pool-capped', () => {
  const gap = peakBonusCents({ offPeakPayCents: 5578, peakCutPayCents: 6205, poolBalanceCents: 100_000 })
  assert.equal(gap.targetCents, 7251)
  assert.equal(gap.bonusCents, 836) // 15% of off-peak pay
  assert.deepEqual(gap.cappedBy, ['share'])
  assert.equal(peakBonusCents({ offPeakPayCents: 5578, peakCutPayCents: 6205, poolBalanceCents: 300 }).bonusCents, 300)
  assert.equal(peakBonusCents({ offPeakPayCents: 5578, peakCutPayCents: 6205, poolBalanceCents: 0 }).bonusCents, 0)
  assert.equal(peakBonusCents({ offPeakPayCents: 472, peakCutPayCents: 708, poolBalanceCents: 100_000 }).bonusCents, 0, 'no gap, no bonus')
  assert.equal(peakBonusCents({ offPeakPayCents: 100_00, peakCutPayCents: 110_00, poolBalanceCents: 100_000 }).bonusCents, 1000, '$10 per-trip cap')
})

test('worked example: Grand Marc to GSP, $69.73 Standard, airport rush', () => {
  const s = surchargeForFare(6973, 1000)
  const plan = planPeakTrip({ baseFareCents: 6973, riderFareCents: 6973 + s.surchargeCents, poolBalanceCents: 50_000 })
  assert.equal(plan.riderFareCents, 7670)
  assert.equal(plan.peakCutPayCents, 6205)
  assert.equal(plan.bonusCents, 836)
  assert.equal(plan.driverTotalCents, 7041)
  assert.equal(plan.upliftBps, 2623)
  assert.equal(plan.platformTakeCents, 1465)
  assert.equal(plan.offPeakPlatformTakeCents, 1395)
  assert.equal(plan.platformDeltaCents, 70)
  assert.equal(plan.poolAfterCents, 49_164)
  assert.equal(plan.guardrails.ok, true)
})

test('worked example: Grand Marc to GSP on game day hits the $25 cap', () => {
  const s = surchargeForFare(6973, 5000)
  const plan = planPeakTrip({ baseFareCents: 6973, riderFareCents: 6973 + s.surchargeCents, poolBalanceCents: 50_000 })
  assert.equal(plan.riderFareCents, 9473)
  assert.equal(plan.peakCutPayCents, 7828)
  assert.equal(plan.bonusCents, 0, 'cut already above the +30% target')
  assert.equal(plan.upliftBps, 4034)
  assert.equal(plan.platformDeltaCents, 250)
  assert.equal(plan.guardrails.ok, true)
})

test('worked example: $5.90 campus trip on game day', () => {
  const s = surchargeForFare(590, 5000)
  const plan = planPeakTrip({ baseFareCents: 590, riderFareCents: 590 + s.surchargeCents, poolBalanceCents: 50_000 })
  assert.equal(plan.riderFareCents, 885)
  assert.equal(plan.driverTotalCents, 708)
  assert.equal(plan.bonusCents, 0)
  assert.equal(plan.upliftBps, 5000)
  assert.equal(plan.platformTakeCents, 177)
  assert.equal(plan.guardrails.ok, true)
})

test('guardrails: platform never loses money and pool never goes negative across many trips', () => {
  for (const share of [7000, 7500, 8000]) {
    for (const bps of [0, 500, 1000, 2500, 5000, 7500]) {
      for (const fare of [499, 590, 1116, 3230, 6973, 17544]) {
        for (const pool of [0, 37, 500, 100_000]) {
          const sc = surchargeForFare(fare, bps)
          const plan = planPeakTrip({ baseFareCents: fare, riderFareCents: fare + sc.surchargeCents, baseShareBps: share, poolBalanceCents: pool })
          assert.equal(plan.guardrails.ok, true, JSON.stringify({ share, bps, fare, pool, v: plan.guardrails.violations }))
          assert.ok(plan.surchargeCents + plan.bonusCents >= plan.driverTotalCents - plan.offPeakPayCents)
          assert.ok(plan.platformDeltaCents >= 0)
          assert.ok(plan.bonusCents <= pool)
          assert.ok(plan.poolAfterCents >= 0)
          assert.ok(plan.driverTotalCents >= plan.offPeakPayCents)
          assert.ok(plan.upliftBps <= PEAK_DEFAULTS.bandCeilingBps)
        }
      }
    }
  }
})

test('guardrail checker flags each kind of violation', () => {
  const bad = checkPeakGuardrails({ baseFareCents: 1000, riderFareCents: 1100, offPeakPayCents: 800, driverTotalCents: 1500, bonusCents: 300, poolBalanceCents: 100 })
  assert.equal(bad.ok, false)
  for (const v of ['platform_loses_money', 'bonus_exceeds_pool', 'pool_negative', 'driver_over_band_ceiling']) assert.ok(bad.violations.includes(v), v)
  assert.ok(checkPeakGuardrails({ baseFareCents: 1000, riderFareCents: 1000, offPeakPayCents: 800, driverTotalCents: 700, bonusCents: 0 }).violations.includes('driver_paid_less_than_off_peak'))
})

test('base fare recovers from the charged fare', () => {
  assert.equal(baseFareFromCharged(7670, 1000), 6973)
  assert.equal(baseFareFromCharged(590, 0), 590)
})

test('copy: rider sees the surcharge before confirming; no driver earnings promise', () => {
  assert.equal(peakRiderLine({ reasonLabel: 'Game day', surchargeBps: 5000, surchargeCents: 295 }), 'Game day peak pricing: +50% ($2.95) is included in this price.')
  assert.equal(peakRiderLine({ surchargeBps: 0 }), null)
  const line = peakDriverLine({ active: true, reasonLabel: 'Airport rush' })
  assert.match(line, /^Before you go online: Airport rush pricing is on\./)
  assert.doesNotMatch(line, /\$\d/, 'no dollar figure promised to drivers')
  assert.doesNotMatch(line, /guarantee/i)
  assert.match(peakDriverLine({ active: false }), /standard fares/)
})
