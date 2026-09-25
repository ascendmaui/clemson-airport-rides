import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// pricing.js imports './supabase' (Vite-only). The loader swaps in a mock
// client we can control per test. Nothing here talks to a real database.
register('../../tests/fixtures/pricingLoader.mjs', import.meta.url)

const {
  applyStudentDiscount,
  getGameDayMultiplier,
  quoteWithSurge,
  priceAirportRide,
  formatUsdFromCents,
  STUDENT_DISCOUNT_BPS,
} = await import('./pricing.js')
const { setMockSupabase, resetMockSupabase } = await import('../../tests/fixtures/supabaseStub.js')
const { quoteFare, cardDepositCents, AIRPORT_ROUTE_FALLBACK } = await import('./fareRates.js')

const STUDENT_LABEL = 'Clemson student · 10% off Standard'

// Fixed instants (EDT, UTC-4 in late September 2026).
const WED_NOON_ET = new Date('2026-09-23T16:00:00Z') // no surge rule matches
const WED_6AM_ET = new Date('2026-09-23T10:00:00Z') // airport rush (1.35), airport only
const FRI_530PM_ET = new Date('2026-09-25T21:30:00Z') // weekend starts Fri 17:00 (1.2) + airport rush
const SAT_1030AM_ET = new Date('2026-09-26T14:30:00Z') // weekend, before game-day fallback window
const SAT_NOON_ET = new Date('2026-09-26T16:00:00Z') // Saturday in Sept: game-day fallback 1.8

// Hand-computed from FARE_CARD (base 119 + booking 265 + 114/mi + 18/min).
// GSP fallback 48 mi / 55 min → 119 + 265 + 5472 + 990 = 6846.
const GSP_BASE = 6846
// CLT fallback 130 mi / 130 min → 119 + 265 + 14820 + 2340 = 17544.
const CLT_BASE = 17544

/**
 * Fake Supabase client for the game_day_events query chain in
 * getGameDayMultiplier. Records every call so tests can assert the filters.
 */
function fakeSupabase({ rows = [], error = null } = {}) {
  const calls = []
  const builder = {
    select(cols) { calls.push(['select', cols]); return builder },
    eq(col, val) { calls.push(['eq', col, val]); return builder },
    lte(col, val) { calls.push(['lte', col, val]); return builder },
    gte(col, val) { calls.push(['gte', col, val]); return builder },
    order(col, opts) { calls.push(['order', col, opts]); return builder },
    limit(n) {
      calls.push(['limit', n])
      return Promise.resolve({ data: error ? null : rows, error })
    },
  }
  return {
    calls,
    from(table) { calls.push(['from', table]); return builder },
  }
}

function gameDayRow(overrides = {}) {
  return {
    id: 'gd-1',
    title: 'Clemson vs. South Carolina',
    starts_at: '2026-09-26T14:00:00Z',
    ends_at: '2026-09-27T04:00:00Z',
    surge_multiplier: 2,
    pickup_zone_label: 'Lot 5 / Memorial Stadium',
    active: true,
    ...overrides,
  }
}

test.afterEach(() => resetMockSupabase())

// ---------------------------------------------------------------------------
// applyStudentDiscount
// ---------------------------------------------------------------------------

test('applyStudentDiscount: exported rate is the shared 10% (1000 bps)', () => {
  assert.equal(STUDENT_DISCOUNT_BPS, 1000)
})

test('applyStudentDiscount: verified student on Standard gets 10% off, rounded to the cent', () => {
  assert.deepEqual(applyStudentDiscount(GSP_BASE, { isStudent: true, tier: 'standard' }), {
    fareCents: 6161, // 6846 - round(684.6)
    discountCents: 685,
    label: STUDENT_LABEL,
  })
  // Half-cent rounds up on the discount: 1005 * 10% = 100.5 → 101 off.
  assert.deepEqual(applyStudentDiscount(1005, { isStudent: true }), {
    fareCents: 904,
    discountCents: 101,
    label: STUDENT_LABEL,
  })
})

test('applyStudentDiscount: discount + discounted fare always add back to the original fare', () => {
  for (const cents of [1, 9, 10, 99, 590, 1234, 6846, 17544, 99999]) {
    const r = applyStudentDiscount(cents, { isStudent: true })
    assert.equal(r.fareCents + r.discountCents, cents, `fare ${cents}`)
    assert.ok(r.discountCents >= 0 && r.discountCents <= cents)
  }
})

test('applyStudentDiscount: tier defaults to standard when omitted', () => {
  assert.equal(applyStudentDiscount(2000, { isStudent: true }).fareCents, 1800)
})

test('applyStudentDiscount: non-students and non-Standard tiers pay full price with no label', () => {
  const full = { fareCents: 2000, discountCents: 0, label: null }
  assert.deepEqual(applyStudentDiscount(2000), full)
  assert.deepEqual(applyStudentDiscount(2000, {}), full)
  assert.deepEqual(applyStudentDiscount(2000, { isStudent: false }), full)
  for (const tier of ['comfort', 'xl', 'premium', 'Standard', 'STANDARD']) {
    assert.deepEqual(applyStudentDiscount(2000, { isStudent: true, tier }), full, `tier ${tier}`)
  }
})

test('applyStudentDiscount: bad fare input becomes 0 instead of NaN', () => {
  for (const bad of [undefined, null, 'abc', NaN, {}]) {
    assert.deepEqual(applyStudentDiscount(bad, { isStudent: false }), { fareCents: 0, discountCents: 0, label: null })
    const s = applyStudentDiscount(bad, { isStudent: true })
    assert.equal(s.fareCents, 0)
    assert.equal(s.discountCents, 0)
  }
  // Numeric strings are coerced.
  assert.equal(applyStudentDiscount('1000', { isStudent: true }).fareCents, 900)
})

test('applyStudentDiscount: matches quoteFare student math for the same fare (UI == checkout)', () => {
  for (const [miles, minutes] of [[0, 0], [3, 10], [48, 55], [130, 130]]) {
    const plain = quoteFare({ miles, minutes })
    const student = quoteFare({ miles, minutes, isStudent: true })
    const shown = applyStudentDiscount(plain.fareBeforeCreditsCents, { isStudent: true })
    assert.equal(shown.fareCents, student.fareBeforeCreditsCents, `${miles} mi / ${minutes} min`)
    assert.equal(shown.discountCents, student.breakdown.student_discount_cents)
  }
})

// BUG?: the two student-eligibility checks disagree on some inputs. Documented, not fixed
// (money path). applyStudentDiscount uses `tier && tier !== 'standard'`, so tier '' counts
// as Standard; quoteFare uses `tier == null || tier === 'standard'`, so tier '' gets no discount.
test("BUG?: tier '' is discounted by applyStudentDiscount but not by quoteFare", () => {
  assert.equal(applyStudentDiscount(2000, { isStudent: true, tier: '' }).discountCents, 200)
  assert.equal(quoteFare({ miles: 3, minutes: 10, isStudent: true, tier: '' }).breakdown.student_discount_cents, 0)
})

// BUG?: the non-student branch returns Number(fareCents) as-is (negative / fractional kept),
// while the student branch goes through percentOffCents, which clamps to >= 0 and rounds.
test('BUG?: non-student branch passes negative and fractional cents through unchanged', () => {
  assert.equal(applyStudentDiscount(-500, { isStudent: false }).fareCents, -500)
  assert.equal(applyStudentDiscount(-500, { isStudent: true }).fareCents, 0)
  assert.equal(applyStudentDiscount(999.6, { isStudent: false }).fareCents, 999.6)
  assert.equal(applyStudentDiscount(999.6, { isStudent: true }).fareCents, 900)
})

test('applyStudentDiscount: isStudent is a truthiness check (callers must pass a verified boolean)', () => {
  assert.equal(applyStudentDiscount(1000, { isStudent: 'yes' }).discountCents, 100)
  assert.equal(applyStudentDiscount(1000, { isStudent: 0 }).discountCents, 0)
  assert.equal(applyStudentDiscount(1000, { isStudent: '' }).discountCents, 0)
})

// ---------------------------------------------------------------------------
// getGameDayMultiplier
// ---------------------------------------------------------------------------

test('getGameDayMultiplier: no Supabase client → no multiplier, no query', async () => {
  resetMockSupabase()
  assert.deepEqual(await getGameDayMultiplier(SAT_NOON_ET), { multiplier: null, event: null })
})

test('getGameDayMultiplier: queries active events overlapping `at`, highest surge first, one row', async () => {
  const sb = fakeSupabase({ rows: [gameDayRow()] })
  setMockSupabase(sb)
  const out = await getGameDayMultiplier(SAT_NOON_ET)
  assert.equal(out.multiplier, 2)
  assert.equal(out.event.title, 'Clemson vs. South Carolina')
  const iso = SAT_NOON_ET.toISOString()
  assert.deepEqual(sb.calls, [
    ['from', 'game_day_events'],
    ['select', 'id, title, starts_at, ends_at, surge_multiplier, pickup_zone_label, active'],
    ['eq', 'active', true],
    ['lte', 'starts_at', iso],
    ['gte', 'ends_at', iso],
    ['order', 'surge_multiplier', { ascending: false }],
    ['limit', 1],
  ])
})

test('getGameDayMultiplier: accepts an ISO string or epoch ms for `at`', async () => {
  const sb = fakeSupabase({ rows: [gameDayRow({ surge_multiplier: '1.5' })] })
  setMockSupabase(sb)
  assert.equal((await getGameDayMultiplier('2026-09-26T16:00:00Z')).multiplier, 1.5)
  assert.equal((await getGameDayMultiplier(SAT_NOON_ET.getTime())).multiplier, 1.5)
  const lte = sb.calls.filter((c) => c[0] === 'lte').map((c) => c[2])
  assert.deepEqual(lte, [SAT_NOON_ET.toISOString(), SAT_NOON_ET.toISOString()])
})

test('getGameDayMultiplier: query error or no rows → null multiplier and null event', async () => {
  setMockSupabase(fakeSupabase({ error: { message: 'permission denied' } }))
  assert.deepEqual(await getGameDayMultiplier(SAT_NOON_ET), { multiplier: null, event: null })
  setMockSupabase(fakeSupabase({ rows: [] }))
  assert.deepEqual(await getGameDayMultiplier(SAT_NOON_ET), { multiplier: null, event: null })
  setMockSupabase(fakeSupabase({ rows: null }))
  assert.deepEqual(await getGameDayMultiplier(SAT_NOON_ET), { multiplier: null, event: null })
})

test('getGameDayMultiplier: non-numeric surge → multiplier null but the event is still returned', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 'high' })] }))
  const out = await getGameDayMultiplier(SAT_NOON_ET)
  assert.equal(out.multiplier, null)
  assert.equal(out.event.id, 'gd-1')
})

// BUG?: Number(null) is 0 (finite), so a row with a NULL surge_multiplier yields multiplier 0
// rather than null. resolveSurge ignores anything <= 1, so the rider price is unaffected.
test('BUG?: NULL surge_multiplier comes back as 0, not null', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: null })] }))
  assert.equal((await getGameDayMultiplier(SAT_NOON_ET)).multiplier, 0)
})

// ---------------------------------------------------------------------------
// quoteWithSurge: game-day multiplier + student discount together
// ---------------------------------------------------------------------------

test('quoteWithSurge: weekday midday, no event → no surge; student gets 10% off', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  const plain = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55 })
  assert.equal(plain.surge.multiplier, 1)
  assert.equal(plain.surge.rule, null)
  assert.equal(plain.gameDay, null)
  assert.equal(plain.quote.fareBeforeCreditsCents, GSP_BASE)

  const student = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55, isStudent: true })
  assert.equal(student.quote.fareBeforeCreditsCents, 6161)
  assert.equal(student.quote.breakdown.student_discount_cents, 685)
})

test('quoteWithSurge: student discount is applied AFTER the game-day surge', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 1.5 })] }))
  // Wednesday so neither weekend nor the Saturday fallback window can interfere.
  const q = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55, isStudent: true })
  assert.equal(q.surge.multiplier, 1.5)
  assert.equal(q.surge.rule.id, 'game_day')
  const surged = Math.round(GSP_BASE * 1.5) // 10269
  assert.equal(q.quote.breakdown.surged_cents, surged)
  assert.equal(q.quote.breakdown.student_discount_cents, Math.round(surged * 0.1)) // 1027
  assert.equal(q.quote.fareBeforeCreditsCents, surged - 1027) // 9242
  assert.deepEqual(q.gameDay, {
    title: 'Clemson vs. South Carolina',
    multiplier: 1.5,
    zone: 'Lot 5 / Memorial Stadium',
  })
})

test('quoteWithSurge: Saturday fallback window (1.8) wins over a smaller DB event', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 1.5 })] }))
  const q = await quoteWithSurge({ at: SAT_NOON_ET, miles: 48, minutes: 55, isStudent: true })
  assert.equal(q.surge.multiplier, 1.8)
  assert.equal(q.surge.rule.id, 'game_day')
  assert.equal(q.quote.breakdown.surged_cents, 12323) // round(6846 * 1.8)
  assert.equal(q.quote.fareBeforeCreditsCents, 11091) // 12323 - round(1232.3)
  // gameDay reports the multiplier actually charged, not the DB row's value.
  assert.equal(q.gameDay.multiplier, 1.8)
})

test('quoteWithSurge: a bigger DB event beats the fallback, and is capped at SURGE_MAX 2.5', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 2 })] }))
  assert.equal((await quoteWithSurge({ at: SAT_NOON_ET, miles: 48, minutes: 55 })).surge.multiplier, 2)

  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 4 })] }))
  const capped = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55, isStudent: true })
  assert.equal(capped.surge.multiplier, 2.5)
  assert.equal(capped.quote.breakdown.surged_cents, Math.round(GSP_BASE * 2.5))
})

test('quoteWithSurge: no DB client on a Saturday still applies the 1.8 fallback', async () => {
  resetMockSupabase()
  const q = await quoteWithSurge({ at: SAT_NOON_ET, miles: 48, minutes: 55 })
  assert.equal(q.surge.multiplier, 1.8)
  assert.equal(q.gameDay, null) // no event row, so no game-day banner data
})

test('quoteWithSurge: Saturday before 11:00 ET is weekend (1.2), not game day', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  const q = await quoteWithSurge({ at: SAT_1030AM_ET, miles: 48, minutes: 55 })
  assert.equal(q.surge.multiplier, 1.2)
  assert.equal(q.surge.rule.id, 'weekend')
})

test('quoteWithSurge: DB multiplier of 1 or less is not a game-day surge', async () => {
  for (const m of [1, 0.5, 0, -2]) {
    setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: m })] }))
    const q = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55 })
    assert.equal(q.surge.multiplier, 1, `db multiplier ${m}`)
    assert.equal(q.quote.fareBeforeCreditsCents, GSP_BASE)
  }
})

test('quoteWithSurge: carpool 15% comes off first, then student 10% off the remainder', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  const q = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55, isStudent: true, isCarpool: true })
  assert.equal(q.quote.breakdown.carpool_discount_cents, 1027) // round(6846 * 0.15)
  assert.equal(q.quote.breakdown.student_discount_cents, 582) // round(5819 * 0.10)
  assert.equal(q.quote.fareBeforeCreditsCents, 5237)
})

test('quoteWithSurge: non-Standard tier gets surge but no student discount', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 1.5 })] }))
  const q = await quoteWithSurge({ at: WED_NOON_ET, miles: 48, minutes: 55, isStudent: true, tier: 'xl' })
  assert.equal(q.quote.breakdown.student_discount_cents, 0)
  assert.equal(q.quote.fareBeforeCreditsCents, Math.round(GSP_BASE * 1.5))
})

test('quoteWithSurge: airport rush only applies to airport trips; weekend starts Fri 17:00 ET', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  assert.equal((await quoteWithSurge({ at: WED_6AM_ET, miles: 3, minutes: 10 })).surge.multiplier, 1)
  assert.equal((await quoteWithSurge({ at: WED_6AM_ET, airport: true, miles: 3, minutes: 10 })).surge.multiplier, 1.35)
  const fri = await quoteWithSurge({ at: FRI_530PM_ET, miles: 3, minutes: 10 })
  assert.equal(fri.surge.rule.id, 'weekend')
  const friAirport = await quoteWithSurge({ at: FRI_530PM_ET, airport: true, miles: 3, minutes: 10 })
  assert.equal(friAirport.surge.multiplier, 1.35)
  assert.deepEqual(friAirport.surge.matched.map((m) => m.id), ['airport_rush', 'weekend'])
})

// ---------------------------------------------------------------------------
// priceAirportRide
// ---------------------------------------------------------------------------

test('priceAirportRide: unknown airport rejects before touching the database', async () => {
  const sb = fakeSupabase({ rows: [] })
  setMockSupabase(sb)
  await assert.rejects(priceAirportRide({ airport: 'ATL' }), /Unknown airport/)
  await assert.rejects(priceAirportRide({ airport: 'gsp' }), /Unknown airport/)
  assert.equal(sb.calls.length, 0)
})

test('priceAirportRide: GSP fallback route, student, no surge', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  const r = await priceAirportRide({ airport: 'GSP', isStudent: true, at: WED_NOON_ET })
  assert.equal(r.airport, 'GSP')
  assert.equal(r.fareCents, 6161)
  assert.equal(r.discountCents, 685)
  assert.equal(r.studentLabel, STUDENT_LABEL)
  assert.equal(r.depositCents, 1540) // round(6161 * 0.25)
  assert.equal(r.depositCents, cardDepositCents(r.fareCents))
  assert.equal(r.platformFeeCents, 1232) // 20%
  assert.equal(r.driverEarningsCents, 4929)
  assert.equal(r.platformFeeCents + r.driverEarningsCents, r.fareCents)
  assert.equal(r.surge.multiplier, 1)
  assert.equal(r.gameDay, null)
  assert.equal(r.quote.miles, AIRPORT_ROUTE_FALLBACK.GSP.miles)
  assert.equal(r.quote.minutes, AIRPORT_ROUTE_FALLBACK.GSP.minutes)
})

test('priceAirportRide: non-student and non-Standard get no discount and no student label', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  const plain = await priceAirportRide({ airport: 'GSP', at: WED_NOON_ET })
  assert.equal(plain.fareCents, GSP_BASE)
  assert.equal(plain.discountCents, 0)
  assert.equal(plain.studentLabel, null)

  const xl = await priceAirportRide({ airport: 'GSP', isStudent: true, tier: 'xl', at: WED_NOON_ET })
  assert.equal(xl.discountCents, 0)
  assert.equal(xl.studentLabel, null)
  assert.equal(xl.fareCents, GSP_BASE)
})

test('priceAirportRide: CLT fallback route, student', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  const r = await priceAirportRide({ airport: 'CLT', isStudent: true, at: WED_NOON_ET })
  assert.equal(r.fareCents, CLT_BASE - 1754) // 15790
  assert.equal(r.discountCents, 1754)
  assert.equal(r.depositCents, Math.round(15790 * 0.25))
})

test('priceAirportRide: game day + airport rush + student stack as highest-surge-then-discount', async () => {
  setMockSupabase(fakeSupabase({ rows: [gameDayRow({ surge_multiplier: 2 })] }))
  const r = await priceAirportRide({ airport: 'GSP', isStudent: true, at: SAT_NOON_ET })
  assert.equal(r.surge.multiplier, 2) // DB event 2.0 > fallback 1.8 > weekend 1.2
  const surged = GSP_BASE * 2 // 13692
  assert.equal(r.discountCents, Math.round(surged * 0.1)) // 1369
  assert.equal(r.fareCents, surged - 1369) // 12323
  assert.equal(r.depositCents, cardDepositCents(12323))
  assert.equal(r.gameDay.zone, 'Lot 5 / Memorial Stadium')

  // Weekday early morning: airport rush (1.35) applies to airport rides.
  setMockSupabase(fakeSupabase({ rows: [] }))
  const rush = await priceAirportRide({ airport: 'GSP', isStudent: true, at: WED_6AM_ET })
  assert.equal(rush.surge.rule.id, 'airport_rush')
  assert.equal(rush.fareCents, 9242 - 924) // round(6846*1.35)=9242, 10% = 924
})

test('priceAirportRide: live route distance/duration override the fallback, each independently', async () => {
  setMockSupabase(fakeSupabase({ rows: [] }))
  // Exactly the fallback route expressed in meters / seconds → same price.
  const same = await priceAirportRide({ airport: 'GSP', at: WED_NOON_ET, distanceM: 48 * 1609.344, durationS: 55 * 60 })
  assert.equal(same.fareCents, GSP_BASE)

  // Only distance known: minutes fall back to 55.
  const distOnly = await priceAirportRide({ airport: 'GSP', at: WED_NOON_ET, distanceM: 40 * 1609.344 })
  assert.equal(distOnly.quote.minutes, 55)
  assert.equal(Math.round(distOnly.quote.miles), 40)
  assert.equal(distOnly.fareCents, 119 + 265 + 40 * 114 + 55 * 18)

  // Only duration known: miles fall back to 48.
  const durOnly = await priceAirportRide({ airport: 'GSP', at: WED_NOON_ET, durationS: 70 * 60 })
  assert.equal(durOnly.quote.miles, 48)
  assert.equal(durOnly.fareCents, 119 + 265 + 48 * 114 + 70 * 18)
})

// ---------------------------------------------------------------------------
// formatUsdFromCents
// ---------------------------------------------------------------------------

test('formatUsdFromCents: formats cents as US dollars', () => {
  assert.equal(formatUsdFromCents(6161), '$61.61')
  assert.equal(formatUsdFromCents(0), '$0.00')
  assert.equal(formatUsdFromCents(5), '$0.05')
  assert.equal(formatUsdFromCents('1234'), '$12.34')
  assert.equal(formatUsdFromCents(123456), '$1,234.56')
})
