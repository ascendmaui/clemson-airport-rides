import assert from 'node:assert/strict'
import test from 'node:test'
import handleQuote from './endpoints/quoteFare.js'
import { priceCheckoutBody, priceScheduledRequest, quoteAirportCheckout } from './authoritativeFare.js'
import { peakPricingEnabled, peakQuoteFields, peakStatus, peakSurgeMode, readTripPeak, settlePeakPricing } from './peakPricing.js'
import { driverTripEarnings } from '../shared/driverTripEarnings.js'
import { normalizePeakStatus } from '../packages/rides-native/tigerHeat.js'
import { parsePeakQuote, parseQuoteResponse } from '../packages/rides-native/riderMoney.js'
import { peakSurgeView } from '../packages/rides-native/peakStatus.js'

const SIKES = { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 }
const COOPER = { label: 'Cooper Library', lat: 34.6765, lng: -82.8375 }
const GAME = new Date('2026-10-17T15:00:00Z') // Sat 11:00 ET, Charleston Southern at noon
const OPEN_SATURDAY = new Date('2026-10-10T18:00:00Z') // no game; legacy fallback fires 1.8x
const QUIET = new Date('2026-10-15T15:00:00Z') // Thu 11:00 ET
const RUSH = new Date('2026-10-15T20:00:00Z') // Thu 16:00 ET

const ON = { PEAK_PRICING_ENABLED: '1' }

function withEnv(env, fn) {
  const saved = {}
  for (const key of ['PEAK_PRICING_ENABLED', 'PEAK_PRICING_CONFIG']) {
    saved[key] = process.env[key]
    if (env[key] == null) delete process.env[key]
    else process.env[key] = env[key]
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    const out = fn()
    if (out && typeof out.then === 'function') return out.finally(restore)
    restore()
    return out
  } catch (error) {
    restore()
    throw error
  }
}

test('flag defaults OFF and keeps legacy pricing byte for byte', () => withEnv({}, () => {
  assert.equal(peakPricingEnabled({}), false)
  assert.equal(peakPricingEnabled({ PEAK_PRICING_ENABLED: 'true' }), true)
  assert.deepEqual(peakSurgeMode({ at: GAME }), { kind: 'legacy' })
  const legacy = priceScheduledRequest({ pickup: SIKES, dropoff: COOPER, at: OPEN_SATURDAY })
  assert.equal(legacy.surge.multiplier, 1.8, 'legacy fallback still applies while the flag is off')
  assert.equal(legacy.peak, undefined)
  assert.equal(legacy.breakdown.peak_surcharge_bps, undefined)
  assert.deepEqual(peakStatus({ at: GAME }), { enabled: false, active: false })
}))

test('flag ON: open Saturday has no surcharge (no fallback game day)', () => withEnv(ON, () => {
  const priced = priceScheduledRequest({ pickup: SIKES, dropoff: COOPER, at: OPEN_SATURDAY })
  assert.equal(priced.surge.multiplier, 1)
  assert.equal(priced.peak, undefined)
  const quiet = priceScheduledRequest({ pickup: SIKES, dropoff: COOPER, at: QUIET })
  assert.equal(quiet.fareCents, priced.fareCents)
}))

test('flag ON: game day adds +50% and records the base fare', () => withEnv(ON, () => {
  const off = priceScheduledRequest({ pickup: SIKES, dropoff: COOPER, at: QUIET })
  const game = priceScheduledRequest({ pickup: SIKES, dropoff: COOPER, at: GAME })
  assert.equal(off.fareCents, 590)
  assert.equal(game.fareCents, 885)
  assert.equal(game.peak.reason, 'game_day')
  assert.equal(game.peak.surchargeBps, 5000)
  assert.equal(game.peak.baseFareCents, 590)
  assert.equal(game.peak.surchargeCents, 295)
  assert.equal(game.breakdown.peak_surcharge_bps, 5000)
  assert.equal(game.breakdown.peak_base_fare_cents, 590)
  assert.equal(game.breakdown.peak_pay_base_cents, 590)
  assert.equal(game.breakdown.peak_pay_peak_cents, 885)
  assert.equal(game.surge.rule.label, 'Peak · Game day')
  const fields = peakQuoteFields(game)
  assert.equal(fields.riderLine, 'Game day peak pricing: +50% ($2.95) is included in this price.')
}))

test('flag ON: student discount applies after the surcharge; driver pay basis stays pre-discount', () => withEnv(ON, () => {
  const game = priceScheduledRequest({ pickup: SIKES, dropoff: COOPER, at: GAME, isStudent: true })
  assert.equal(game.fareCents, 796) // 885 less 10% (89)
  assert.equal(game.peak.baseFareCents, 531)
  assert.equal(game.breakdown.peak_pay_base_cents, 590)
  assert.equal(game.breakdown.peak_pay_peak_cents, 885)
}))

test('flag ON: airport rush is +10% on demand and never on a scheduled ride', () => withEnv(ON, () => {
  const onDemand = quoteAirportCheckout({ airport: 'GSP', at: RUSH })
  assert.equal(onDemand.peak.reason, 'airport_rush')
  assert.equal(onDemand.peak.surchargeBps, 1000)
  const scheduled = priceScheduledRequest({ pickup: SIKES, dropoff: { label: 'GSP Airport' }, airport: 'GSP', at: RUSH, scheduleAhead: true })
  assert.equal(scheduled.peak, undefined)
  assert.equal(scheduled.surge.multiplier, 1)
  const checkout = priceCheckoutBody({ body: { airport: 'GSP', at: RUSH.toISOString() }, at: RUSH, now: RUSH })
  assert.equal(checkout.peak.reason, 'airport_rush')
}))

test('flag ON: GSP game day surcharge is held at the $25 cap', () => withEnv(ON, () => {
  const gsp = quoteAirportCheckout({ airport: 'GSP', at: GAME })
  assert.equal(gsp.peak.dollarCapped, true)
  assert.ok(gsp.peak.surchargeCents <= 2500)
  assert.ok(gsp.peak.surchargeCents >= 2490)
}))

test('quote endpoint returns the peak block so the rider sees it before confirming', async () => {
  await withEnv(ON, async () => {
    const res = { statusCode: 200, body: '', headers: {}, setHeader() {}, end(p) { this.body = String(p ?? '') } }
    await handleQuote({ method: 'POST', headers: {}, body: { pickupLabel: 'Sikes Hall', pickupLat: SIKES.lat, pickupLng: SIKES.lng, dest: 'Cooper Library', destLat: COOPER.lat, destLng: COOPER.lng, at: GAME.toISOString() } }, res, { sb: null, user: null, now: GAME, computeRoutes: async () => ({ error: 'off' }) })
    const body = JSON.parse(res.body)
    assert.equal(res.statusCode, 200)
    assert.equal(body.peak.surchargeBps, 5000)
    assert.match(body.peak.riderLine, /Game day peak pricing: \+50%/)
    const parsed = parseQuoteResponse(body)
    assert.equal(parsed.peak.surchargePct, 50)
  })
  await withEnv({}, async () => {
    const res = { statusCode: 200, body: '', headers: {}, setHeader() {}, end(p) { this.body = String(p ?? '') } }
    await handleQuote({ method: 'POST', headers: {}, body: { pickupLabel: 'Sikes Hall', pickupLat: SIKES.lat, pickupLng: SIKES.lng, dest: 'Cooper Library', destLat: COOPER.lat, destLng: COOPER.lng, at: GAME.toISOString() } }, res, { sb: null, user: null, now: GAME, computeRoutes: async () => ({ error: 'off' }) })
    assert.equal(JSON.parse(res.body).peak, null)
  })
  assert.equal(parsePeakQuote(null), null)
})

function poolSb(initial = 0, { failRpc = false } = {}) {
  const state = { balance: initial, draws: new Map(), contributions: new Map(), calls: [] }
  return {
    state,
    async rpc(name, args) {
      state.calls.push([name, args])
      if (failRpc) return { data: null, error: { message: 'function does not exist' } }
      if (name === 'peak_pool_balance') return { data: [{ balance_cents: state.balance }], error: null }
      if (name === 'peak_pool_draw') {
        if (state.draws.has(args.p_trip_id)) return { data: [{ granted_cents: state.draws.get(args.p_trip_id) }], error: null }
        const granted = Math.min(args.p_requested_cents, state.balance)
        state.balance -= granted
        state.draws.set(args.p_trip_id, granted)
        return { data: [{ granted_cents: granted }], error: null }
      }
      if (name === 'peak_pool_contribute') {
        if (state.contributions.has(args.p_trip_id)) return { data: [{ recorded_cents: state.contributions.get(args.p_trip_id) }], error: null }
        const cents = Math.min(args.p_amount_cents, Math.max(0, args.p_ceiling_cents - state.balance))
        state.balance += cents
        state.contributions.set(args.p_trip_id, cents)
        return { data: [{ recorded_cents: cents }], error: null }
      }
      return { data: null, error: { message: 'unknown' } }
    },
  }
}

const gspRushTrip = {
  id: 't-gsp',
  driver_id: 'd1',
  status: 'in_progress',
  fare_cents: 7670,
  fare_breakdown: { peak_surcharge_bps: 1000, peak_base_fare_cents: 6973, peak_pay_base_cents: 6973, peak_pay_peak_cents: 7670, peak_reason: 'airport_rush' },
  metadata: { driver_share_bps: 8000, driver_payout_cents: 6136 },
}

test('settle: flag off does nothing', async () => {
  await withEnv({}, async () => {
    assert.equal(await settlePeakPricing({ sb: poolSb(5000), trip: gspRushTrip }), null)
  })
})

test('settle: peak trip gets the higher cut plus a pool bonus, and the payout uses it', async () => {
  await withEnv(ON, async () => {
    const sb = poolSb(50_000)
    const settled = await settlePeakPricing({ sb, trip: gspRushTrip, now: RUSH })
    assert.equal(settled.kind, 'peak')
    assert.equal(settled.peakCutPayCents, 6205)
    assert.equal(settled.bonusCents, 836)
    assert.equal(settled.driverEarningsCents, 7041)
    assert.equal(settled.guardrails.ok, true)
    assert.equal(sb.state.balance, 50_000 - 836)
    // Retry is idempotent: no second draw.
    const again = await settlePeakPricing({ sb, trip: gspRushTrip, now: RUSH })
    assert.equal(again.bonusCents, 836)
    assert.equal(sb.state.balance, 50_000 - 836)
    const earned = driverTripEarnings({ ...gspRushTrip, status: 'completed', metadata: { ...gspRushTrip.metadata, peak_pricing: settled } })
    assert.equal(earned.fareNetCents, 7041)
    assert.equal(earned.peakBonusCents, 836)
  })
})

test('settle: bonus is capped by the pool and is $0 when the pool is empty or missing', async () => {
  await withEnv(ON, async () => {
    const thin = poolSb(120)
    const a = await settlePeakPricing({ sb: thin, trip: gspRushTrip })
    assert.equal(a.bonusCents, 120)
    assert.equal(thin.state.balance, 0)
    const empty = await settlePeakPricing({ sb: poolSb(0), trip: { ...gspRushTrip, id: 't2' } })
    assert.equal(empty.bonusCents, 0)
    assert.equal(empty.driverEarningsCents, 6205)
    const missing = await settlePeakPricing({ sb: poolSb(0, { failRpc: true }), trip: { ...gspRushTrip, id: 't3' } })
    assert.equal(missing.bonusCents, 0)
    assert.equal(missing.error, 'pool_unavailable')
    assert.equal(missing.guardrails.ok, true)
  })
})

test('settle: regular trip contributes 2% to the pool; e2e trips are skipped', async () => {
  await withEnv(ON, async () => {
    const sb = poolSb(0)
    const regular = { id: 't-reg', driver_id: 'd1', fare_cents: 6973, fare_breakdown: {}, metadata: {} }
    const out = await settlePeakPricing({ sb, trip: regular })
    assert.equal(out.kind, 'contribution')
    assert.equal(out.contributionCents, 139)
    assert.equal(sb.state.balance, 139)
    assert.equal(await settlePeakPricing({ sb, trip: { ...regular, id: 'e2e', metadata: { e2e_test: true } } }), null)
    // A regular trip's payout is unchanged (contribution comes out of the platform fee).
    const earned = driverTripEarnings({ ...regular, status: 'completed', metadata: { peak_pricing: out } })
    assert.equal(earned.fareNetCents, 6973 - Math.round(6973 * 0.2))
  })
})

test('readTripPeak ignores trips without peak keys', () => {
  assert.equal(readTripPeak({ fare_breakdown: {} }), null)
  assert.equal(readTripPeak(gspRushTrip).surchargeBps, 1000)
})

test('driver status: disabled unless the server enables it; copy has no earnings promise', () => {
  assert.deepEqual(normalizePeakStatus(null), { enabled: false, active: false })
  const live = withEnv(ON, () => peakStatus({ at: GAME }))
  assert.equal(live.enabled, true)
  assert.equal(live.active, true)
  assert.equal(live.reasonLabel, 'Game day')
  assert.deepEqual(live.reasons, ['Game day'])
  assert.doesNotMatch(live.driverLine, /\$\d/)
  const view = peakSurgeView(normalizePeakStatus(live))
  assert.equal(view.multiplierLabel, '+50%')
  assert.equal(peakSurgeView({ enabled: false }), null)
  const quietStatus = withEnv(ON, () => peakStatus({ at: QUIET }))
  assert.equal(quietStatus.active, false)
})
