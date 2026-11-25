// John's 2026-10-17 surge decision: weekend 1.0x; game day 1.25x only on Clemson
// home football days from kickoff-4h to kickoff+3h and only when the pickup or
// dropoff is within ~2 mi of Memorial Stadium; never stacked, capped at 1.25x.
import assert from 'node:assert/strict'
import test from 'node:test'
import { priceCheckoutBody, priceDriverRequest, priceScheduledRequest, quoteAirportCheckout } from './authoritativeFare.js'
import handleQuote from './endpoints/quoteFare.js'
import { CARPOOL_SEAT_FRACTION_BPS, SURGE_MAX, quoteFare, resolveSurge, scaleCents } from '../src/lib/fareRates.js'
import { fareAuthorizationCents } from '../shared/fareAuthorization.js'
import {
  GAME_DAY_LABEL,
  MEMORIAL_STADIUM,
  activeHomeGame,
  gameDaySurge,
  gameWindow,
  homeGames,
  milesBetween,
  normalizeHomeGames,
  resetGameDayState,
  setGameDayConfig,
} from '../shared/gameDaySurge.js'
import { CLEMSON_HOME_FOOTBALL, CLEMSON_HOME_FOOTBALL_SOURCE } from '../shared/data/clemsonHomeFootball.js'

const STADIUM = { label: 'Memorial Stadium', lat: 34.6788, lng: -82.8432 }
const DOWNTOWN = { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 } // ~0.4 mi
const WALMART = { label: 'Clemson Walmart', lat: 34.6926, lng: -82.8063 } // ~2.3 mi
const SENECA = { label: 'Seneca', lat: 34.6857, lng: -82.9532 } // ~6 mi
const ANDERSON = { label: 'Anderson', lat: 34.5034, lng: -82.6501 }

// Sat Oct 17 2026, Charleston Southern at 12:00 ET -> window 08:00-15:00 ET (12:00Z-19:00Z).
const IN_WINDOW = new Date('2026-10-17T16:30:00Z') // 12:30 ET
const BEFORE_WINDOW = new Date('2026-10-17T11:30:00Z') // 07:30 ET
const AFTER_WINDOW = new Date('2026-10-17T19:30:00Z') // 15:30 ET
const OPEN_SATURDAY = new Date('2026-10-31T17:00:00Z') // Sat 13:00 ET, no home game
const WEEKDAY = new Date('2026-10-28T17:00:00Z') // Wed 13:00 ET
const ROUTE = { distanceM: 2414, durationS: 360 }

test.beforeEach(() => resetGameDayState())

test('seed is only the remaining 2026 home games, with the source URL', () => {
  assert.match(CLEMSON_HOME_FOOTBALL_SOURCE, /^https:\/\/clemsontigers\.com\/sports\/football\/schedule/)
  assert.deepEqual(CLEMSON_HOME_FOOTBALL.map((g) => g.date), ['2026-10-17', '2026-10-24', '2026-11-14', '2026-11-28'])
  assert.equal(homeGames().length, 4)
  const tba = homeGames().filter((g) => g.tba)
  assert.equal(tba.length, 3)
})

test('windows: kickoff-4h to kickoff+3h; TBA uses the stored default window', () => {
  const csu = homeGames().find((g) => g.date === '2026-10-17')
  const w = gameWindow(csu)
  assert.equal(new Date(w.startMs).toISOString(), '2026-10-17T12:00:00.000Z')
  assert.equal(new Date(w.endMs).toISOString(), '2026-10-17T19:00:00.000Z')
  const gt = gameWindow(homeGames().find((g) => g.date === '2026-11-14'))
  assert.equal(gt.tba, true)
  assert.equal(new Date(gt.startMs).toISOString(), '2026-11-14T15:00:00.000Z') // 10:00 EST
  assert.equal(new Date(gt.endMs).toISOString(), '2026-11-15T04:59:00.000Z') // 23:59 EST
  assert.equal(activeHomeGame(BEFORE_WINDOW), null)
  assert.equal(activeHomeGame(AFTER_WINDOW), null)
  assert.equal(activeHomeGame(IN_WINDOW).opponent, 'Charleston Southern')
})

test('radius: ~2 mi from Memorial Stadium, pickup OR dropoff', () => {
  assert.deepEqual(MEMORIAL_STADIUM, { label: 'Memorial Stadium', lat: 34.6788, lng: -82.8432 })
  assert.ok(milesBetween(STADIUM, DOWNTOWN) < 1)
  assert.ok(milesBetween(STADIUM, WALMART) > 2)
  assert.equal(gameDaySurge({ at: IN_WINDOW, pickup: SENECA, dropoff: DOWNTOWN }).applies, true)
  assert.equal(gameDaySurge({ at: IN_WINDOW, pickup: DOWNTOWN, dropoff: SENECA }).applies, true)
  assert.equal(gameDaySurge({ at: IN_WINDOW, pickup: SENECA, dropoff: ANDERSON }).reason, 'outside_radius')
  assert.equal(gameDaySurge({ at: IN_WINDOW, pickup: null, dropoff: null }).applies, false)
})

test('weekend is 1.0x: a non-game Saturday prices exactly like a weekday', () => {
  assert.equal(resolveSurge({ at: OPEN_SATURDAY, pickup: STADIUM, dropoff: DOWNTOWN }).multiplier, 1)
  const sat = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at: OPEN_SATURDAY, ...ROUTE })
  const wed = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at: WEEKDAY, ...ROUTE })
  assert.equal(sat.fareCents, wed.fareCents)
  assert.equal(sat.surge.multiplier, 1)
})

test('game day inside window and radius is 1.25x', () => {
  const plain = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at: WEEKDAY, ...ROUTE })
  const game = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at: IN_WINDOW, ...ROUTE })
  assert.equal(game.surge.multiplier, 1.25)
  assert.equal(game.surge.rule.id, 'game_day')
  assert.equal(game.surge.rule.label, GAME_DAY_LABEL)
  assert.equal(game.fareCents, Math.round(plain.fareCents * 1.25))
})

test('game day outside the window or outside the radius is 1.0x', () => {
  const plain = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at: WEEKDAY, ...ROUTE }).fareCents
  for (const at of [BEFORE_WINDOW, AFTER_WINDOW]) {
    const p = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at, ...ROUTE })
    assert.equal(p.surge.multiplier, 1, at.toISOString())
    assert.equal(p.fareCents, plain)
  }
  const far = priceScheduledRequest({ pickup: SENECA, dropoff: ANDERSON, at: IN_WINDOW, ...ROUTE })
  assert.equal(far.surge.multiplier, 1)
})

test('no stacking: weekend + game day + airport rush still caps at 1.25x', () => {
  setGameDayConfig({ weekendMultiplier: 1.2 }) // even if weekend were turned back on
  const s = resolveSurge({ at: IN_WINDOW, airport: 'GSP', pickup: STADIUM, dropoff: DOWNTOWN, gameDayMultiplier: 1.8 })
  assert.equal(s.multiplier, 1.25)
  assert.equal(s.rule.id, 'game_day')
  assert.equal(SURGE_MAX, 1.25)
  setGameDayConfig({ multiplier: 3, weekendMultiplier: 2 })
  assert.equal(resolveSurge({ at: IN_WINDOW, pickup: STADIUM }).multiplier, 1.25, 'config can never exceed the cap')
})

test('carpool seat = 50% of the surged Standard (multiplier before the 50%)', () => {
  const places = { pickup: STADIUM, dropoff: DOWNTOWN }
  const std = priceDriverRequest(places, { at: IN_WINDOW, ...ROUTE })
  const seat = priceDriverRequest(places, { at: IN_WINDOW, ...ROUTE, tier: 'carpool', seatCount: 1 })
  const two = priceDriverRequest(places, { at: IN_WINDOW, ...ROUTE, tier: 'carpool', seatCount: 2 })
  assert.equal(std.surge.multiplier, 1.25)
  assert.equal(seat.fareCents, scaleCents(std.fareCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.equal(two.fareCents, seat.fareCents * 2)
  // Same math straight from the engine.
  const raw = quoteFare({ distanceM: ROUTE.distanceM, durationS: ROUTE.durationS, surgeMultiplier: 1 }).fareCents
  const engineSeat = quoteFare({ distanceM: ROUTE.distanceM, durationS: ROUTE.durationS, surgeMultiplier: 1.25, tier: 'carpool' }).fareCents
  assert.equal(engineSeat, Math.round(Math.round(raw * 1.25) * 0.5))
})

test('Extra Comfort and Wait & Save keep their relative pricing on game day', () => {
  const places = { pickup: STADIUM, dropoff: DOWNTOWN }
  const ratio = (tier, at) => priceDriverRequest(places, { at, ...ROUTE, tier }).fareCents / priceDriverRequest(places, { at, ...ROUTE }).fareCents
  for (const tier of ['comfort', 'wait']) {
    assert.ok(Math.abs(ratio(tier, IN_WINDOW) - ratio(tier, WEEKDAY)) < 0.01, tier)
  }
})

test('scheduled ride is priced at its scheduled pickup time, not booking time', () => {
  // Booked on a Wednesday for game time: surged.
  const ahead = priceScheduledRequest({ pickup: DOWNTOWN, dropoff: STADIUM, at: IN_WINDOW, scheduleAhead: true, ...ROUTE })
  assert.equal(ahead.surge.multiplier, 1.25)
  // Booked during the game window for next Wednesday: not surged.
  const later = priceScheduledRequest({ pickup: DOWNTOWN, dropoff: STADIUM, at: WEEKDAY, scheduleAhead: true, ...ROUTE })
  assert.equal(later.surge.multiplier, 1)
})

test('airport quotes use the stadium pickup, so GSP from campus is 1.25x in the window', () => {
  const game = quoteAirportCheckout({ airport: 'GSP', at: IN_WINDOW })
  const off = quoteAirportCheckout({ airport: 'GSP', at: WEEKDAY })
  assert.equal(game.surge.multiplier, 1.25)
  assert.equal(off.surge.multiplier, 1)
  const checkout = priceCheckoutBody({ body: { airport: 'GSP', at: IN_WINDOW.toISOString() }, at: IN_WINDOW, now: IN_WINDOW })
  assert.equal(checkout.fareCents, game.fareCents, 'checkout charges what the quote showed')
})

test('card hold reflects the surged fare', () => {
  const game = priceScheduledRequest({ pickup: STADIUM, dropoff: DOWNTOWN, at: IN_WINDOW, ...ROUTE })
  const hold = fareAuthorizationCents(game.fareCents, { bufferBps: 0 })
  assert.equal(hold.authorizationCents, game.fareCents)
  const buffered = fareAuthorizationCents(game.fareCents)
  assert.ok(buffered.authorizationCents >= game.fareCents)
})

test('DB rows replace the seed; bad rows are ignored', () => {
  const rows = normalizeHomeGames([
    { game_date: '2026-11-14', opponent: 'Georgia Tech', kickoff_et: '19:30', kickoff_tba: false, active: true },
    { game_date: 'nope', opponent: 'x' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kickoffMin, 19 * 60 + 30)
})

function fakeRes() {
  return { statusCode: 200, body: '', headers: {}, setHeader() {}, end(p) { this.body = String(p ?? '') } }
}

test('quote endpoint returns the upfront total with a Game-day pricing block', async () => {
  const body = { pickupLabel: 'Memorial Stadium', pickupLat: STADIUM.lat, pickupLng: STADIUM.lng, dest: 'Downtown', destLat: DOWNTOWN.lat, destLng: DOWNTOWN.lng }
  const res = fakeRes()
  await handleQuote({ method: 'POST', headers: {}, body: { ...body, at: IN_WINDOW.toISOString() } }, res, { sb: null, user: null, now: IN_WINDOW, computeRoutes: async () => ({ error: 'off' }) })
  const json = JSON.parse(res.body)
  assert.equal(res.statusCode, 200)
  assert.equal(json.gameDayPricing.active, true)
  assert.equal(json.gameDayPricing.label, 'Game-day pricing')
  assert.equal(json.gameDayPricing.multiplier, 1.25)
  assert.match(json.gameDayPricing.explainer, /1\.25x/)
  const quiet = fakeRes()
  await handleQuote({ method: 'POST', headers: {}, body: { ...body, at: WEEKDAY.toISOString() } }, quiet, { sb: null, user: null, now: WEEKDAY, computeRoutes: async () => ({ error: 'off' }) })
  assert.equal(JSON.parse(quiet.body).gameDayPricing, null)
})
