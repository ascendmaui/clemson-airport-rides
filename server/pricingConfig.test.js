import assert from 'node:assert/strict'
import test from 'node:test'
import { activeFareCards, quoteFare, resetFareCards } from '../src/lib/fareRates.js'
import { gameDayConfig, homeGames, resetGameDayState } from '../shared/gameDaySurge.js'
import { PRICING_CONFIG_TTL_MS, pricingConfigSnapshot, pricingSettings, refreshPricingConfig, resetPricingConfigCache, settingsFromRow } from './pricingConfig.js'
import { logMarginAlert, marginForPriced, resetMarginAlertThrottle, summarizeMarginAlerts, yesterdayEtRange } from './marginAlerts.js'
import { priceScheduledRequest } from './authoritativeFare.js'

function fakeSb(tables, { fail = false } = {}) {
  const calls = []
  const inserts = []
  return {
    calls,
    inserts,
    from(table) {
      calls.push(table)
      const q = {
        select() { return q },
        eq() { return q },
        insert(row) { inserts.push({ table, row }); return Promise.resolve({ error: null }) },
        then(resolve, reject) {
          if (fail) return Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve, reject)
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
}

const SETTINGS_ROW = {
  id: 1, target_margin_pct: 12.5, stripe_fee_pct: 2.9, stripe_fixed_cents: 30, overhead_cents_per_ride: 80,
  carpool_overhead_seats: 2, floor_per_mile_cents: 90, floor_per_minute_cents: 18, floor_min_fare_cents: 500,
  competitor_undercut_pct: 3, game_day_multiplier: 1.2, game_day_radius_miles: 1.5, game_day_before_min: 240,
  game_day_after_min: 180, weekend_multiplier: 1, surge_cap: 1.25,
}

function reset() {
  resetPricingConfigCache()
  resetFareCards()
  resetGameDayState()
  resetMarginAlertThrottle()
}
test.beforeEach(reset)
test.after(reset)

test('DB card, settings, and home games are applied', async () => {
  const sb = fakeSb({
    pricing_rate_cards: [{ tier: 'standard', base_cents: 100, booking_fee_cents: 250, per_mile_cents: 110, per_minute_cents: 18, min_fare_cents: 575, active: true }],
    pricing_settings: [SETTINGS_ROW],
    clemson_home_games: [{ game_date: '2026-11-14', opponent: 'Georgia Tech', kickoff_et: '15:30:00', kickoff_tba: false, active: true }],
  })
  await refreshPricingConfig(sb, { now: 1000 })
  assert.equal(activeFareCards().standard.minFareCents, 575)
  assert.equal(quoteFare({ miles: 0.1, minutes: 1 }).fareCents, 575)
  assert.equal(pricingSettings().margin.targetMarginBps, 1250)
  assert.equal(pricingSettings().margin.overheadCents, 80)
  assert.equal(gameDayConfig().multiplier, 1.2)
  assert.equal(gameDayConfig().radiusMiles, 1.5)
  assert.equal(homeGames().length, 1)
  assert.equal(homeGames()[0].kickoffMin, 15 * 60 + 30)
  assert.equal(pricingConfigSnapshot().source, 'db')
})

test('cache: one load per TTL', async () => {
  const sb = fakeSb({ pricing_rate_cards: [], pricing_settings: [], clemson_home_games: [] })
  await refreshPricingConfig(sb, { now: 1000 })
  const n = sb.calls.length
  await refreshPricingConfig(sb, { now: 1000 + PRICING_CONFIG_TTL_MS - 1 })
  assert.equal(sb.calls.length, n)
  await refreshPricingConfig(sb, { now: 1000 + PRICING_CONFIG_TTL_MS + 1 })
  assert.equal(sb.calls.length, n * 2)
})

test('bad rows and read errors keep the seed (never a $0 fare)', async () => {
  await refreshPricingConfig(fakeSb({ pricing_rate_cards: [{ tier: 'standard', base_cents: 0, booking_fee_cents: 0, per_mile_cents: 0, per_minute_cents: 0, min_fare_cents: 0, active: true }] }), { now: 1 })
  assert.equal(activeFareCards().standard.minFareCents, 590)
  await refreshPricingConfig(fakeSb({}, { fail: true }), { now: 1, force: true })
  assert.equal(activeFareCards().standard.minFareCents, 590)
  assert.equal(homeGames().length, 4)
  assert.equal(gameDayConfig().multiplier, 1.25)
})

test('game-day settings cannot exceed the 1.25x cap', async () => {
  assert.equal(settingsFromRow({ ...SETTINGS_ROW, game_day_multiplier: 2 }).gameDay.multiplier, 2) // raw row
  await refreshPricingConfig(fakeSb({ pricing_settings: [{ ...SETTINGS_ROW, game_day_multiplier: 2, weekend_multiplier: 2, surge_cap: 3 }] }), { now: 1 })
  assert.ok(gameDayConfig().multiplier <= 1.25)
  assert.ok(gameDayConfig().weekendMultiplier <= 1.25)
  assert.ok(gameDayConfig().surgeCap <= 1.25)
})

test('a DB comfort card prices Comfort directly; carpool stays 50% of Standard', async () => {
  await refreshPricingConfig(fakeSb({
    pricing_rate_cards: [
      { tier: 'standard', base_cents: 119, booking_fee_cents: 265, per_mile_cents: 114, per_minute_cents: 18, min_fare_cents: 590, active: true },
      { tier: 'comfort', base_cents: 138, booking_fee_cents: 310, per_mile_cents: 132, per_minute_cents: 20, min_fare_cents: 690, active: true },
      { tier: 'carpool', base_cents: 1, booking_fee_cents: 1, per_mile_cents: 30, per_minute_cents: 1, min_fare_cents: 200, active: true },
    ],
  }), { now: 1 })
  assert.equal(quoteFare({ miles: 0.1, minutes: 1, tier: 'comfort' }).fareCents, 690)
  assert.equal(quoteFare({ miles: 0.1, minutes: 1, tier: 'carpool' }).fareCents, 295)
})

test('quote margin: carpool checked per seat; below target logs one alert row (throttled)', async () => {
  const at = new Date('2026-10-28T17:00:00Z')
  const seat = priceScheduledRequest({ pickup: { lat: 34.68, lng: -82.84 }, dropoff: { lat: 34.69, lng: -82.85 }, at, tier: 'carpool', seatCount: 2, distanceM: 1300, durationS: 240 })
  const m = marginForPriced(seat, { tier: 'carpool' })
  assert.equal(m.fareCents, seat.perSeatFareCents)
  assert.equal(m.seatCount, 2)
  assert.equal(m.belowTarget, true)
  const sb = fakeSb({})
  const row = await logMarginAlert(sb, { source: 'quote', margin: m, now: 1 })
  assert.equal(row.margin_bps, m.marginBps)
  assert.equal(sb.inserts.length, 1)
  assert.equal(sb.inserts[0].table, 'pricing_margin_alerts')
  await logMarginAlert(sb, { source: 'quote', margin: m, now: 2 })
  assert.equal(sb.inserts.length, 1, 'same quote within 10 minutes is not logged twice')
  await logMarginAlert(sb, { source: 'booking', tripId: 't1', margin: m, now: 3 })
  assert.equal(sb.inserts.length, 2, 'bookings are never throttled')
  const fine = marginForPriced({ fareCents: 6540, breakdown: {} })
  assert.equal(await logMarginAlert(sb, { margin: fine }), null)
})

test('booking margin uses the actual offer-ladder payout', () => {
  const m = marginForPriced({ fareCents: 1000, breakdown: {} }, { driverPayout: 750 })
  assert.equal(m.driverPayoutCents, 750)
  assert.equal(m.profitCents, 1000 - 750 - 59 - 75)
})

test('daily summary: yesterday in ET, totals and worst rides', () => {
  const r = yesterdayEtRange(new Date('2026-11-02T03:00:00Z')) // Nov 1 22:00 EST
  assert.equal(r.label, '2026-10-31')
  assert.equal(r.start.toISOString(), '2026-10-31T04:00:00.000Z')
  assert.equal(r.end.toISOString(), '2026-11-01T04:00:00.000Z')
  const dst = yesterdayEtRange(new Date('2026-11-02T15:00:00Z'))
  assert.equal(dst.label, '2026-11-01')
  assert.equal(dst.end.getTime() - dst.start.getTime(), 25 * 3600 * 1000, 'fall-back day is 25 h')
  const s = summarizeMarginAlerts([
    { source: 'booking', trip_id: 'a', tier: 'standard', fare_cents: 590, profit_cents: -4, margin_bps: -68, target_bps: 1500, surge_multiplier: 1 },
    { source: 'booking', trip_id: 'b', tier: 'carpool', fare_cents: 295, profit_cents: -55, margin_bps: -1864, target_bps: 1500, surge_multiplier: 1 },
    { source: 'quote', tier: 'standard', fare_cents: 663, profit_cents: 9, margin_bps: 136, target_bps: 1500 },
    { source: 'compare', tier: 'basket' },
  ])
  assert.equal(s.belowTargetRides, 2)
  assert.equal(s.unprofitableRides, 2)
  assert.equal(s.lossCents, 59)
  assert.equal(s.belowTargetQuotes, 1)
  assert.equal(s.blockedApplyRuns, 1)
  assert.equal(s.worst[0].tripId, 'b')
  assert.equal(s.shortfallVsTargetCents, (88 + 4) + (44 + 55))
})
