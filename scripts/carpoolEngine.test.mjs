import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFriendFareCents } from '../server/friendRideLib.js'
import { CARPOOL_SEAT_FRACTION_BPS, scaleCents } from '../src/lib/fareRates.js'
import {
  MAX_RIDERS,
  matchCarpoolRequests,
  quoteCarpool,
  pitchQuote,
  surgeDelta,
  chargePlan,
  mvpRouteFareCents,
  demandWindow,
  encodeGeohash,
  firstName,
  approxCoord,
  carpoolSeatCap,
  firstRideWindowOpen,
  firstRideEligible,
  firstRideOfferCopy,
  confirmChargeLabel,
  confirmChargeNote,
  otherFirstRideLabels,
  driverTakeCents,
  overlapScore,
  NEIGHBORHOODS,
} from '../src/lib/carpoolEngine.js'

const GRAND = NEIGHBORHOODS.find((n) => n.id === 'grand-marc')
const COLLEGE = NEIGHBORHOODS.find((n) => n.id === 'college-ave')
const GSP = { lat: 34.8956, lng: -82.2189, label: 'GSP Airport' }

function atEt(isoUtc) {
  return new Date(isoUtc)
}

/** Saturday Sep 26 2026, 10:30pm ET = Sunday 02:30 UTC (EDT is UTC-4). */
const PEAK_SAT_NIGHT = atEt('2026-09-27T02:30:00Z')
/** Saturday Sep 26 2026, 2:00pm ET. */
const GAME_SAT = atEt('2026-09-26T18:00:00Z')
/** Wednesday Sep 23 2026, 8:15am ET. */
const CLASS_AM = atEt('2026-09-23T12:15:00Z')
/** Tuesday noon ET. */
const OFF_PEAK = atEt('2026-09-22T16:00:00Z')

function rider(id, pickup, dropoff, departAt, extra = {}) {
  return {
    id,
    userId: extra.userId || id,
    displayName: extra.displayName || `Rider ${id}`,
    pickup,
    dropoff,
    departAt,
    ...extra,
  }
}

function near(point, metersNorth) {
  const dLat = metersNorth / 110540
  return { ...point, lat: point.lat + dLat, lng: point.lng }
}

test('metered fare stays locked to friendRideLib', () => {
  const samples = [
    [1609, 600],
    [3200, 480],
    [800, 300],
    [0, 0],
  ]
  for (const [distanceM, durationS] of samples) {
    assert.equal(
      mvpRouteFareCents(distanceM, durationS),
      computeFriendFareCents(distanceM, durationS).fareCents,
    )
  }
})

test('demand windows: game day, Thu-Sat night, class change', () => {
  assert.equal(demandWindow(GAME_SAT), 'game_day')
  assert.equal(demandWindow(PEAK_SAT_NIGHT), 'peak_night')
  assert.equal(demandWindow(atEt('2026-09-25T01:30:00Z')), 'peak_night')
  assert.equal(demandWindow(CLASS_AM), 'class_change')
  assert.equal(demandWindow(OFF_PEAK), 'off_peak')
  assert.equal(demandWindow(OFF_PEAK, { gameDay: true }), 'game_day')
})

test('four riders to the same neighborhood share one pool', () => {
  const depart = PEAK_SAT_NIGHT
  const requests = [0, 1, 2, 3].map((i) => rider(
    `r${i}`,
    near(GRAND, i * 40),
    { ...COLLEGE, label: 'College Avenue' },
    depart.getTime() + i * 60 * 1000,
    { displayName: ['Ava Tiger', 'Ben', 'Cio', 'Dee'][i] },
  ))
  const { pools, rejected } = matchCarpoolRequests(requests, { at: depart })
  assert.equal(rejected.length, 0)
  const filled = pools.filter((pool) => !pool.waiting)
  assert.equal(filled.length, 1)
  assert.equal(filled[0].size, 4)
  assert.equal(filled[0].size <= MAX_RIDERS, true)
  assert.equal(filled[0].neighborhoodId, 'college-ave')
  assert.equal(filled[0].window, 'peak_night')
  assert.ok(filled[0].score >= 0.62)
})

test('a fifth rider waits instead of overfilling the car', () => {
  const depart = PEAK_SAT_NIGHT
  const requests = [0, 1, 2, 3, 4].map((i) => rider(
    `r${i}`,
    near(GRAND, i * 30),
    { ...COLLEGE, label: 'College Avenue' },
    depart.getTime() + i * 30 * 1000,
  ))
  const { pools } = matchCarpoolRequests(requests, { at: depart, seats: 7 })
  const sizes = pools.map((pool) => pool.size).sort((a, b) => b - a)
  assert.equal(sizes[0], 4)
  assert.equal(sizes.reduce((s, n) => s + n, 0), 5)
  assert.ok(pools.some((pool) => pool.waiting && pool.size === 1))
})

test('airport dropoff does not join a campus pool', () => {
  const depart = GAME_SAT
  const campus = [0, 1].map((i) => rider(
    `c${i}`,
    near(GRAND, i * 20),
    { ...COLLEGE, label: 'College Avenue' },
    depart,
  ))
  const airport = rider('air', near(GRAND, 10), GSP, depart)
  const { pools } = matchCarpoolRequests([...campus, airport], { at: depart })
  const airportPool = pools.find((pool) => pool.riderIds.includes('air'))
  assert.equal(airportPool.riderIds.includes('c0'), false)
  assert.equal(airportPool.waiting, true)
})

test('riders outside the time window are not matched', () => {
  const depart = PEAK_SAT_NIGHT
  const a = rider('a', GRAND, COLLEGE, depart)
  const b = rider('b', near(GRAND, 40), COLLEGE, depart.getTime() + 50 * 60 * 1000)
  const score = overlapScore(
    matchCarpoolRequests([a], { at: depart }).pools[0].riders[0],
    matchCarpoolRequests([b], { at: depart }).pools[0].riders[0],
  )
  assert.equal(score.ok, false)
  assert.equal(score.reason, 'time_window')
})

test('duplicate user cannot fill a car alone', () => {
  const depart = PEAK_SAT_NIGHT
  const requests = [0, 1, 2].map((i) => rider('dup', near(GRAND, i * 10), COLLEGE, depart.getTime() + i * 1000, {
    userId: 'same-user',
    id: `row-${i}`,
  }))
  const { pools, considered } = matchCarpoolRequests(requests, { at: depart })
  assert.equal(considered, 1)
  assert.equal(pools.length, 1)
  assert.equal(pools[0].waiting, true)
})

test('game-day pools outrank off-peak pools', () => {
  const game = rider('g', GRAND, COLLEGE, GAME_SAT, { displayName: 'Game' })
  const off = rider('o', near({ lat: 34.67, lng: -82.85, label: 'West' }, 0), { lat: 34.671, lng: -82.851, label: 'West lot' }, OFF_PEAK)
  const { pools } = matchCarpoolRequests([off, game], { at: GAME_SAT })
  assert.equal(pools[0].window, 'game_day')
  assert.ok(pools[0].priority < pools[1].priority)
})

test('each carpool seat is half of that rider Standard fare', () => {
  const depart = PEAK_SAT_NIGHT
  const riders = [0, 1, 2, 3].map((i) => rider(
    `r${i}`,
    near(GRAND, i * 25),
    { ...COLLEGE, label: 'College Avenue' },
    depart,
    { displayName: 'Jordan Lee' },
  ))
  const quote = quoteCarpool({ riders, at: depart })
  assert.equal(quote.riderCount, 4)
  assert.equal(quote.shareOfSolo, CARPOOL_SEAT_FRACTION_BPS / 10000)
  for (const share of quote.shares) {
    assert.equal(share.shareCents, scaleCents(share.soloCents, CARPOOL_SEAT_FRACTION_BPS))
    assert.ok(share.shareCents < share.soloCents)
    assert.equal(share.firstName, 'Jordan')
  }
  assert.equal(quote.driver.beatsSolo, true)
  assert.ok(quote.driver.payoutCents >= quote.driver.soloPayoutCents + quote.driver.namedBonusCents)
  const plan = chargePlan(quote)
  assert.equal(plan.chargedCents, quote.grossCents)
  assert.equal(quote.driver.incentiveId, 'driver_carpool_bonus')
})

test('two riders pay the same half-fare seat and still leave the driver ahead', () => {
  const depart = GAME_SAT
  const riders = [0, 1].map((i) => rider(`r${i}`, near(GRAND, i * 20), COLLEGE, depart))
  const quote = quoteCarpool({ riders, at: depart, gameDay: true })
  assert.equal(quote.shareOfSolo, 0.5)
  assert.equal(quote.driver.beatsSolo, true)
  assert.ok(quote.driver.carpoolBonusCents >= quote.driver.namedBonusCents)
  assert.ok(quote.shares.every((share) => share.shareCents === scaleCents(share.soloCents, CARPOOL_SEAT_FRACTION_BPS)))
  const plan = chargePlan(quote)
  assert.equal(plan.chargedCents, quote.grossCents)
  assert.equal(plan.lines.length, 2)
})

test('pre-confirm delta is half of Standard even off-peak', () => {
  const delta = surgeDelta({
    pickup: GRAND,
    dropoff: { ...COLLEGE, label: 'College Avenue' },
    at: OFF_PEAK,
  })
  assert.equal(delta.fullCarShareCents, scaleCents(delta.soloSurgeCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.equal(delta.savingsCents, delta.soloSurgeCents - delta.fullCarShareCents)
  assert.ok(delta.savingsCents > 0)
  assert.equal(delta.driverBeatsSolo, true)
  assert.ok(delta.driverPayoutCents >= delta.driverSoloPayoutCents)
})

test('a 2-rider confirm charges the same half-fare seat as a full car', () => {
  const depart = PEAK_SAT_NIGHT
  const riders = [0, 1].map((i) => rider(`r${i}`, near(GRAND, i * 20), { ...COLLEGE, label: 'College Avenue' }, depart))
  const quote = quoteCarpool({ riders, at: depart })
  const delta = surgeDelta({
    pickup: GRAND,
    dropoff: COLLEGE,
    at: depart,
    quote,
    selfId: 'r0',
  })
  assert.equal(delta.currentRiderCount, 2)
  assert.equal(delta.currentShareCents, scaleCents(quote.shares[0].soloCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.equal(delta.fullCarShareCents, scaleCents(delta.soloSurgeCents, CARPOOL_SEAT_FRACTION_BPS))
})

test('pitch quote shows Standard versus a half-fare Carpool seat', () => {
  const pitch = pitchQuote({
    pickup: GRAND,
    dropoff: { ...COLLEGE, label: 'College Avenue' },
    at: PEAK_SAT_NIGHT,
    displayName: 'Sam',
  })
  assert.equal(pitch.fullShareCents, scaleCents(pitch.soloCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.equal(pitch.savingsCents, pitch.soloCents - pitch.fullShareCents)
  assert.ok(pitch.savingsCents > 0)
  assert.equal(pitch.window, 'peak_night')
})

test('first ride free zeroes one rider and keeps the driver whole', () => {
  const depart = GAME_SAT
  const riders = [0, 1, 2, 3].map((i) => rider(`r${i}`, near(GRAND, i * 20), COLLEGE, depart))
  const before = quoteCarpool({ riders, at: depart, gameDay: true })
  const after = quoteCarpool({
    riders,
    at: depart,
    gameDay: true,
    firstRideFreeIds: ['r1'],
  })
  const comped = after.shares.find((share) => share.id === 'r1')
  assert.equal(comped.firstRideFree, true)
  assert.equal(comped.shareCents, 0)
  assert.equal(after.shares.filter((share) => share.firstRideFree).length, 1)
  assert.ok(after.driver.payoutCents >= before.driver.soloPayoutCents + before.driver.namedBonusCents)
  const plan = chargePlan(after)
  assert.equal(plan.lines.find((line) => line.id === 'r1').amountCents, 0)
  assert.equal(plan.chargedCents, after.grossCents)
  assert.equal(plan.driverPayoutCents + plan.platformFeeCents, plan.chargedCents + plan.subsidyCents)
})

test('missing coordinates are rejected and geohash is stable nearby', () => {
  const { rejected, pools } = matchCarpoolRequests([
    { id: 'bad', pickup: { label: 'nowhere' }, dropoff: COLLEGE },
    rider('ok', GRAND, COLLEGE, PEAK_SAT_NIGHT),
  ], { at: PEAK_SAT_NIGHT })
  assert.equal(rejected[0].error, 'pickup_coords')
  assert.equal(pools.length, 1)
  const hashA = encodeGeohash(COLLEGE.lat, COLLEGE.lng, 6)
  const hashB = encodeGeohash(COLLEGE.lat + 0.0002, COLLEGE.lng + 0.0002, 6)
  assert.equal(hashA, hashB)
  assert.equal(hashA.length, 6)
})

test('privacy helpers and seat caps', () => {
  assert.equal(firstName('Ava Tiger'), 'Ava')
  assert.equal(firstName(''), 'Tiger')
  assert.equal(approxCoord(34.68394), 34.684)
  assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 7 }), 4)
  assert.equal(carpoolSeatCap({ kind: 'carpool', partyType: 'tailgate', matchMode: 'student_driver', vehicleSeats: 7 }), 6)
  assert.equal(carpoolSeatCap({ kind: 'friends', vehicleSeats: 5 }), 5)
  assert.equal(driverTakeCents({ fare_cents: 5000, metadata: { driver_payout_cents: 3200 } }), 3200)
})

test('first ride free is only during game-week peaks', () => {
  assert.equal(firstRideWindowOpen(GAME_SAT), true)
  assert.equal(firstRideWindowOpen(PEAK_SAT_NIGHT), true)
  assert.equal(firstRideWindowOpen(CLASS_AM), true)
  assert.equal(firstRideWindowOpen(OFF_PEAK), false)
  assert.equal(firstRideWindowOpen(GAME_SAT, { enabled: false }), false)
  assert.equal(firstRideWindowOpen(atEt('2026-12-05T18:00:00Z')), false)
})

test('first ride eligibility never promises a comp outside the window', () => {
  const open = { windowOpen: true, alreadyUsed: false, completedTrips: 0 }
  assert.equal(firstRideEligible(open), true)
  assert.equal(firstRideEligible({ ...open, windowOpen: false }), false)
  assert.equal(firstRideEligible({ ...open, alreadyUsed: true }), false)
  assert.equal(firstRideEligible({ ...open, completedTrips: 1 }), false)
  assert.equal(firstRideEligible({ ...open, schemaMissing: true }), false)
  assert.equal(firstRideEligible({ ...open, lookupFailed: true }), false)

  assert.equal(firstRideOfferCopy({ windowOpen: false, signedIn: true }), null)
  assert.equal(firstRideOfferCopy({ windowOpen: true, schemaMissing: true, signedIn: true }), null)
  const eligible = firstRideOfferCopy({ windowOpen: true, signedIn: true })
  assert.equal(eligible.eligible, true)
  assert.equal(eligible.title, 'First ride free')
  const used = firstRideOfferCopy({ windowOpen: true, signedIn: true, alreadyUsed: true })
  assert.equal(used.eligible, false)
  assert.match(used.body, /already used/)
  const ridden = firstRideOfferCopy({ windowOpen: true, signedIn: true, completedTrips: 2 })
  assert.equal(ridden.eligible, false)
  assert.match(ridden.body, /completed trip/)
  const guest = firstRideOfferCopy({ windowOpen: true, signedIn: false })
  assert.equal(guest.eligible, false)
  assert.match(guest.body, /Sign in/)

  assert.equal(confirmChargeLabel({ firstRideFree: true, shareCents: 0 }), 'Confirm · First ride free')
  assert.equal(confirmChargeLabel({ shareCents: 1200 }), 'Confirm · charge $12.00 each')
  assert.equal(confirmChargeNote({ firstRideFree: true, shareCents: 0 }), 'First ride free. This confirm charges $0 for your seat.')
  assert.match(confirmChargeNote({ shareCents: 925, riderCount: 3, fullCarShareCents: 925 }), /50% of the Standard fare per seat/)
  assert.deepEqual(
    otherFirstRideLabels({ shares: [{ id: 'a', firstRideFree: true, firstName: 'Ava' }, { id: 'b', firstRideFree: true, firstName: 'Bea' }] }, 'a'),
    ['Bea'],
  )
})
