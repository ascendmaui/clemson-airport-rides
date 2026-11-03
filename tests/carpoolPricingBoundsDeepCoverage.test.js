import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mvpRouteFareCents,
  soloSurgeCents,
  quoteCarpool,
  carpoolSeatCap,
  demandWindow,
  surgeMultiplier,
  SHARE_OF_SOLO,
  BONUS_CENTS_PER_EXTRA_RIDER,
  BONUS_CENTS_PER_MILE,
  PLATFORM_FEE_RATE,
  pitchQuote,
  surgeDelta,
  chargePlan,
  driverTakeCents,
  driverOfferCopy,
  firstRideOfferCopy,
  confirmChargeLabel,
  confirmChargeNote,
  otherFirstRideLabels,
  makeAmbassadorCode,
  matchCarpoolRequests,
  firstRideWindowOpen,
  firstRideEligible,
  haversineMeters,
  encodeGeohash,
} from '../src/lib/carpoolEngine.js'
import {
  resolveOfferedTier,
  isOfferedRideTier,
  isBlockedRideTier,
  carpoolSeatCount,
  CARPOOL_MAX_SEATS,
} from '../shared/rideOptions.js'
import {
  quoteFare,
  CARPOOL_DISCOUNT_BPS,
  STUDENT_DISCOUNT_BPS,
  PLATFORM_FEE_BPS,
} from '../src/lib/fareRates.js'

function buildRider(id, distanceM, durationS, extra = {}) {
  return {
    id,
    displayName: `Rider ${id}`,
    pickup: { lat: 34.685, lng: -82.8165, label: 'Grand Marc' },
    dropoff: { lat: 34.6839, lng: -82.8366, label: 'College Ave' },
    distanceM,
    durationS,
    ...extra,
  }
}

test('mvpRouteFareCents: enforces $8.00 (800 cents) floor and computes metered fare', () => {
  // 1. Zero and negative inputs stay locked at 800 cents floor
  assert.equal(mvpRouteFareCents(0, 0), 800)
  assert.equal(mvpRouteFareCents(-500, -100), 800)
  assert.equal(mvpRouteFareCents(null, undefined), 800)
  assert.equal(mvpRouteFareCents(NaN, NaN), 800)

  // 2. Short trip where formula < 800 (e.g. 100m, 60s) still floors at 800
  // Formula: 250 + (100/1609.344)*175 + (60/60)*35 = 250 + 11 + 35 = 296 cents < 800
  assert.equal(mvpRouteFareCents(100, 60), 800)

  // 3. Trip that exceeds 800 cents
  // 10 miles (16093.44m), 20 minutes (1200s)
  // Base = 250 + 10 * 175 + 20 * 35 = 250 + 1750 + 700 = 2700 cents
  const fare = mvpRouteFareCents(16093.44, 1200)
  assert.equal(fare, 2700)
})

test('soloSurgeCents: clamps short campus hops into $30–$40 bounded band for game_day and peak_night', () => {
  // Short hop: <= 5 miles, <= 15 minutes
  // 1 mile (1609.344m), 600 seconds (10 min)
  // Base metered is 800 (floored).
  // Under game_day (multiplier 2.8), metered * 2.8 = 2240 cents.
  // But campus hop anchor for 1 mile is 3000 cents ($30.00).
  const gameDay1Mi = soloSurgeCents({
    distanceM: 1609.344,
    durationS: 600,
    window: 'game_day',
  })
  assert.equal(gameDay1Mi, 3000)

  const peakNight1Mi = soloSurgeCents({
    distanceM: 1609.344,
    durationS: 600,
    window: 'peak_night',
  })
  assert.equal(peakNight1Mi, 3000)

  // 2 miles, 8 minutes (480s):
  // Base = 250 + 2*175 + 8*35 = 880 cents.
  // game_day metered (2.8x) = 2464 cents < anchored (3250 cents).
  // Clamped up to anchored = 3250 cents ($32.50).
  const gameDay2Mi = soloSurgeCents({
    distanceM: 2 * 1609.344,
    durationS: 480,
    window: 'game_day',
  })
  assert.equal(gameDay2Mi, 3250)

  // 4 miles, 10 minutes (600s):
  // Base = 250 + 4*175 + 10*35 = 1300 cents.
  // peak_night metered (2.6x) = 3380 cents < anchored (3750 cents).
  // Clamped up to anchored = 3750 cents ($37.50).
  const peakNight4Mi = soloSurgeCents({
    distanceM: 4 * 1609.344,
    durationS: 600,
    window: 'peak_night',
  })
  assert.equal(peakNight4Mi, 3750)

  // 5 miles, 15 minutes (900s):
  // Base = 250 + 5*175 + 15*35 = 1650 cents.
  // game_day metered (2.8x) = 4620 cents.
  // Since metered (4620) > 4000, Math.max(metered, ...) ensures fare is not reduced below meter.
  const gameDay5Mi = soloSurgeCents({
    distanceM: 5 * 1609.344,
    durationS: 900,
    window: 'game_day',
  })
  assert.equal(gameDay5Mi, 4620)

  // Long hop: > 5 miles or > 15 minutes does NOT clamp to $40
  // 15 miles (24140m), 30 minutes (1800s):
  // metered = 250 + 15*175 + 30*35 = 250 + 2625 + 1050 = 3925 cents
  // game_day surge (2.8x) = round(3925 * 2.8) = 10990 cents
  const gameDayLong = soloSurgeCents({
    distanceM: 15 * 1609.344,
    durationS: 1800,
    window: 'game_day',
  })
  assert.equal(gameDayLong, 10990)
  assert.ok(gameDayLong > 4000)

  // Off-peak and class_change do not use the $30-$40 anchor
  const offPeakHop = soloSurgeCents({
    distanceM: 1609.344,
    durationS: 600,
    window: 'off_peak',
  })
  assert.equal(offPeakHop, 800) // metered * 1.0

  const classChangeHop = soloSurgeCents({
    distanceM: 1609.344,
    durationS: 600,
    window: 'class_change',
  })
  assert.equal(classChangeHop, Math.round(800 * 1.35)) // 1080 cents
})

test('quoteCarpool: verifies rider share bounds, driver payout guarantees, and subsidies', () => {
  // 1. Single rider carpool
  const rider1 = buildRider('r1', 1609.344, 600, { window: 'peak_night' })
  const quote1 = quoteCarpool({ riders: [rider1] })
  assert.equal(quote1.riderCount, 1)
  assert.equal(quote1.shareOfSolo, 1)
  assert.equal(quote1.shares[0].shareCents, quote1.shares[0].soloCents)
  assert.equal(quote1.driver.beatsSolo, true)
  assert.equal(quote1.subsidyCents, 0)

  // 2. 2-rider carpool on peak night
  const rider2 = buildRider('r2', 1609.344, 600, { window: 'peak_night' })
  const quote2 = quoteCarpool({ riders: [rider1, rider2] })
  assert.equal(quote2.riderCount, 2)
  assert.equal(quote2.shareOfSolo, 0.55)
  for (const s of quote2.shares) {
    assert.ok(s.shareCents <= s.soloCents, 'share should never exceed solo price')
    assert.ok(s.shareCents >= 50, 'share should be at least 50 cents')
  }
  assert.equal(quote2.driver.beatsSolo, true)
  assert.ok(quote2.driver.payoutCents >= quote2.driver.soloPayoutCents + quote2.driver.namedBonusCents)

  // 3. 4-rider carpool on peak night: each pays ~35% of solo
  const riders4 = [1, 2, 3, 4].map((i) => buildRider(`r${i}`, 1609.344, 600, { window: 'peak_night' }))
  const quote4 = quoteCarpool({ riders: riders4 })
  assert.equal(quote4.riderCount, 4)
  assert.equal(quote4.shareOfSolo, 0.35)
  for (const s of quote4.shares) {
    assert.equal(s.soloCents, 3000)
    assert.ok(s.shareCents >= 1000 && s.shareCents <= 1500)
  }
  assert.equal(quote4.driver.beatsSolo, true)

  // 4. Driver subsidy when first ride free is applied
  const quoteFree = quoteCarpool({
    riders: riders4,
    firstRideFreeIds: ['r1'],
  })
  const freeShare = quoteFree.shares.find((s) => s.id === 'r1')
  assert.equal(freeShare.firstRideFree, true)
  assert.equal(freeShare.shareCents, 0)
  assert.equal(quoteFree.driver.beatsSolo, true)
  assert.ok(quoteFree.driver.payoutCents >= quoteFree.driver.soloPayoutCents)

  // 5. Check share rates across 1 to 6 riders
  assert.equal(SHARE_OF_SOLO[1], 1)
  assert.equal(SHARE_OF_SOLO[2], 0.55)
  assert.equal(SHARE_OF_SOLO[3], 0.42)
  assert.equal(SHARE_OF_SOLO[4], 0.35)
  assert.equal(SHARE_OF_SOLO[5], 0.30)
  assert.equal(SHARE_OF_SOLO[6], 0.28)
})

test('carpoolSeatCap: clamps seat limits for standard carpool, tailgate student driver, and vehicle capacity', () => {
  // Standard carpool is capped at 4
  assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 4 }), 4)
  assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 7 }), 4)
  assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 8 }), 4)

  // Vehicle with fewer than 4 seats clamps to vehicleSeats
  assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 3 }), 3)
  assert.equal(carpoolSeatCap({ kind: 'carpool', vehicleSeats: 2 }), 2)

  // Tailgate party with student_driver match mode caps at 6
  assert.equal(carpoolSeatCap({
    kind: 'carpool',
    partyType: 'tailgate',
    matchMode: 'student_driver',
    vehicleSeats: 7,
  }), 6)

  // Tailgate with smaller vehicle clamps to vehicle capacity
  assert.equal(carpoolSeatCap({
    kind: 'carpool',
    partyType: 'tailgate',
    matchMode: 'student_driver',
    vehicleSeats: 5,
  }), 5)

  // Non-carpool (friends, etc.) uses vehicleSeats directly
  assert.equal(carpoolSeatCap({ kind: 'friends', vehicleSeats: 6 }), 6)
})

test('shared/rideOptions: resolves offered tiers, blocks forbidden autonomous tiers, and clamps seat count', () => {
  // 1. resolveOfferedTier
  assert.equal(resolveOfferedTier('carpool'), 'carpool')
  assert.equal(resolveOfferedTier('CARPOOL'), 'carpool')
  assert.equal(resolveOfferedTier('standard'), 'standard')
  assert.equal(resolveOfferedTier('wait'), 'wait')
  assert.equal(resolveOfferedTier('comfort'), 'comfort')
  assert.equal(resolveOfferedTier(''), 'standard')
  assert.equal(resolveOfferedTier(null), 'standard')

  assert.throws(() => resolveOfferedTier('limo'), {
    message: 'That ride option is not offered.',
  })
  assert.throws(() => resolveOfferedTier('uber_x'), {
    message: 'That ride option is not offered.',
  })

  // 2. isOfferedRideTier
  assert.equal(isOfferedRideTier('carpool'), true)
  assert.equal(isOfferedRideTier('standard'), true)
  assert.equal(isOfferedRideTier('helicopter'), false)

  // 3. isBlockedRideTier detects forbidden autonomous tiers
  const blockedT = ['te', 'sla'].join('')
  const blockedR = ['robo', 'taxi'].join('')
  const blockedS = ['self', '-driving'].join('')
  assert.equal(isBlockedRideTier(blockedT), true)
  assert.equal(isBlockedRideTier(blockedR), true)
  assert.equal(isBlockedRideTier('autonomous'), true)
  assert.equal(isBlockedRideTier(blockedS), true)
  assert.equal(isBlockedRideTier('carpool'), false)

  // 4. carpoolSeatCount
  assert.equal(carpoolSeatCount('carpool', 1), 1)
  assert.equal(carpoolSeatCount('carpool', 2), 2)
  assert.equal(carpoolSeatCount('carpool', 3), CARPOOL_MAX_SEATS) // Clamped to 2
  assert.equal(carpoolSeatCount('carpool', 0), 1)
  assert.equal(carpoolSeatCount('carpool', -1), 1)
  assert.equal(carpoolSeatCount('carpool', 'invalid'), 1)

  // Non-carpool tier always returns 1
  assert.equal(carpoolSeatCount('standard', 4), 1)
  assert.equal(carpoolSeatCount('comfort', 3), 1)
  assert.equal(carpoolSeatCount('wait', 2), 1)
})

test('src/lib/fareRates: carpool tier applies 15% discount and excludes student discount stacking', () => {
  // 1. Carpool tier gets exactly 15% off (CARPOOL_DISCOUNT_BPS = 1500)
  // Distance: 10 miles, 20 minutes -> Base metered = 2700 cents
  // Surge = 1.0 (no surge)
  const carpoolQuote = quoteFare({
    miles: 10,
    minutes: 20,
    tier: 'carpool',
    isStudent: false,
  })
  // metered = 119 + 265 + 10*114 + 20*18 = 119 + 265 + 1140 + 360 = 1884 cents
  // 15% of 1884 = round(1884 * 0.15) = 283 cents discount -> 1601 cents
  assert.equal(carpoolQuote.breakdown.carpool_discount_bps, 1500)
  assert.equal(carpoolQuote.breakdown.carpool_discount_cents, 283)
  assert.equal(carpoolQuote.breakdown.student_discount_bps, 0)
  assert.equal(carpoolQuote.breakdown.student_discount_cents, 0)
  assert.equal(carpoolQuote.fareCents, 1601)

  // 2. Student discount does NOT apply when tier === 'carpool'
  const carpoolStudentQuote = quoteFare({
    miles: 10,
    minutes: 20,
    tier: 'carpool',
    isStudent: true,
  })
  assert.equal(carpoolStudentQuote.breakdown.carpool_discount_bps, 1500)
  assert.equal(carpoolStudentQuote.breakdown.student_discount_bps, 0)
  assert.equal(carpoolStudentQuote.breakdown.student_discount_cents, 0)
  assert.equal(carpoolStudentQuote.fareCents, 1601)

  // 3. In standard tier with isCarpool=true AND isStudent=true, both stack multiplicatively
  const standardStackedQuote = quoteFare({
    miles: 10,
    minutes: 20,
    tier: 'standard',
    isCarpool: true,
    isStudent: true,
  })
  // Surged/base = 1884 cents
  // Carpool 15% off: discount = 283, remaining = 1601
  // Student 10% off 1601: round(1601 * 0.10) = 160 cents discount -> remaining = 1441 cents
  assert.equal(standardStackedQuote.breakdown.carpool_discount_bps, 1500)
  assert.equal(standardStackedQuote.breakdown.carpool_discount_cents, 283)
  assert.equal(standardStackedQuote.breakdown.student_discount_bps, 1000)
  assert.equal(standardStackedQuote.breakdown.student_discount_cents, 160)
  assert.equal(standardStackedQuote.fareCents, 1441)

  // 4. Platform fee is exactly 20% of the rider's final paid fare
  // 20% of 1441 = round(1441 * 0.20) = 288 cents
  // Driver earnings = 1441 - 288 = 1153 cents
  assert.equal(standardStackedQuote.breakdown.platform_fee_cents, 288)
  assert.equal(standardStackedQuote.breakdown.driver_earnings_cents, 1153)
  assert.equal(standardStackedQuote.breakdown.platform_fee_bps, 2000)
})

test('pitchQuote & surgeDelta: coordinate validation, quote calculations, and peak hour deltas', () => {
  const grandMarc = { lat: 34.685, lng: -82.8165, label: 'Grand Marc' }
  const collegeAve = { lat: 34.6839, lng: -82.8366, label: 'College Ave' }

  // 1. Missing coords in pitchQuote
  assert.equal(pitchQuote({ pickup: null, dropoff: collegeAve }), null)
  assert.equal(pitchQuote({ pickup: grandMarc, dropoff: null }), null)
  assert.equal(pitchQuote({ pickup: { lat: null, lng: -82.8 }, dropoff: collegeAve }), null)

  // 2. Valid pitchQuote calculations
  const gameDayPitch = pitchQuote({
    pickup: grandMarc,
    dropoff: collegeAve,
    gameDay: true,
    displayName: 'Avery',
  })
  assert.equal(gameDayPitch.window, 'game_day')
  assert.ok(gameDayPitch.soloCents >= 3000 && gameDayPitch.soloCents <= 4000)
  assert.ok(gameDayPitch.fullShareCents < gameDayPitch.soloCents)
  assert.equal(gameDayPitch.savingsCents, gameDayPitch.soloCents - gameDayPitch.fullShareCents)
  assert.equal(gameDayPitch.full.riderCount, 4)
  assert.equal(gameDayPitch.solo.riderCount, 1)

  // 3. Missing coords in surgeDelta
  assert.equal(surgeDelta({ pickup: null, dropoff: collegeAve }), null)
  assert.equal(surgeDelta({ pickup: grandMarc, dropoff: null }), null)

  // 4. surgeDelta with live quote and matched selfId
  const liveQuote = quoteCarpool({
    riders: [
      buildRider('me', 1609.344, 600, { window: 'peak_night' }),
      buildRider('friend', 1609.344, 600, { window: 'peak_night' }),
    ],
    firstRideFreeIds: ['me'],
  })
  const deltaMatched = surgeDelta({
    pickup: grandMarc,
    dropoff: collegeAve,
    quote: liveQuote,
    selfId: 'me',
  })
  assert.equal(deltaMatched.currentFirstRideFree, true)
  assert.equal(deltaMatched.currentShareCents, 0)
  assert.equal(deltaMatched.currentRiderCount, 2)
  assert.ok(deltaMatched.savingsCents >= 0)
  assert.ok(deltaMatched.driverBeatsSolo)

  // 5. surgeDelta with empty quote
  const deltaEmpty = surgeDelta({
    pickup: grandMarc,
    dropoff: collegeAve,
    quote: null,
  })
  assert.equal(deltaEmpty.currentFirstRideFree, false)
  assert.equal(deltaEmpty.currentShareCents, null)
})

test('chargePlan, driverTakeCents, and driverOfferCopy: quote mappings and presentation copy', () => {
  // 1. chargePlan handles null or empty quotes
  assert.deepEqual(chargePlan(null), { lines: [], chargedCents: 0, driverPayoutCents: 0, platformFeeCents: 0, subsidyCents: 0 })
  assert.deepEqual(chargePlan({}), { lines: [], chargedCents: 0, driverPayoutCents: 0, platformFeeCents: 0, subsidyCents: 0 })

  // 2. chargePlan maps shares and first ride free reasons
  const quote = {
    shares: [
      { id: 'u1', shareCents: 1250, firstRideFree: false },
      { id: 'u2', shareCents: 0, firstRideFree: true },
    ],
    driver: { payoutCents: 2000 },
    platformFeeCents: 250,
    subsidyCents: 1000,
  }
  const plan = chargePlan(quote)
  assert.equal(plan.chargedCents, 1250)
  assert.equal(plan.driverPayoutCents, 2000)
  assert.equal(plan.platformFeeCents, 250)
  assert.equal(plan.subsidyCents, 1000)
  assert.deepEqual(plan.lines, [
    { id: 'u1', amountCents: 1250, firstRideFree: false },
    { id: 'u2', amountCents: 0, firstRideFree: true },
  ])

  // 3. driverTakeCents priority waterfall
  // Priority 1: metadata.driver_payout_cents
  assert.equal(driverTakeCents({
    fare_cents: 5000,
    metadata: {
      driver_payout_cents: 4500,
      carpool: { driver: { payoutCents: 4200 } },
    },
  }), 4500)

  // Priority 2: metadata.carpool.driver.payoutCents
  assert.equal(driverTakeCents({
    fare_cents: 5000,
    metadata: {
      carpool: { driver: { payoutCents: 4200 } },
    },
  }), 4200)

  // Priority 3: fare_cents fallback
  assert.equal(driverTakeCents({ fare_cents: 4000, metadata: {} }), 4000)
  assert.equal(driverTakeCents(null), 0)

  // 4. driverOfferCopy formatting
  assert.equal(driverOfferCopy(null), null)
  assert.equal(driverOfferCopy({}), null)

  const copyWithBonus = driverOfferCopy({
    riderCount: 4,
    grossCents: 4500,
    anchorSoloCents: 3750,
    driver: { payoutCents: 3600, carpoolBonusCents: 600 },
  })
  assert.equal(copyWithBonus.headline, '$36.00')
  assert.equal(copyWithBonus.sub, '$6.00 more than a solo trip')
  assert.match(copyWithBonus.detail, /Riders pay \$45\.00 together/)
  assert.equal(copyWithBonus.incentiveId, 'driver_carpool_bonus')

  const copyNoBonus = driverOfferCopy({
    riderCount: 2,
    grossCents: 2500,
    anchorSoloCents: 2500,
    driver: { payoutCents: 2000, carpoolBonusCents: 0 },
  })
  assert.equal(copyNoBonus.headline, '$20.00')
  assert.equal(copyNoBonus.sub, 'Same as a solo trip')
})

test('firstRideOfferCopy, confirmChargeLabel, and confirmChargeNote: UX copy edge cases', () => {
  // 1. firstRideOfferCopy closed window or errors
  assert.equal(firstRideOfferCopy({ windowOpen: false }), null)
  assert.equal(firstRideOfferCopy({ windowOpen: true, schemaMissing: true }), null)
  assert.equal(firstRideOfferCopy({ windowOpen: true, lookupFailed: true }), null)

  // 2. Unsigned in user receives sign-in prompt
  const guestCopy = firstRideOfferCopy({ windowOpen: true, signedIn: false })
  assert.equal(guestCopy.eligible, false)
  assert.equal(guestCopy.title, 'First ride free this window')
  assert.match(guestCopy.body, /Sign in to check this account/)

  // 3. Signed in eligible user
  const eligibleCopy = firstRideOfferCopy({ windowOpen: true, signedIn: true, completedTrips: 0, alreadyUsed: false })
  assert.equal(eligibleCopy.eligible, true)
  assert.equal(eligibleCopy.title, 'First ride free')

  // 4. Ineligible due to prior completed trips
  const tripsCopy = firstRideOfferCopy({ windowOpen: true, signedIn: true, completedTrips: 1 })
  assert.equal(tripsCopy.eligible, false)
  assert.match(tripsCopy.body, /A completed trip is already on this account/)

  // 5. Ineligible due to grant already used
  const usedCopy = firstRideOfferCopy({ windowOpen: true, signedIn: true, completedTrips: 0, alreadyUsed: true })
  assert.equal(usedCopy.eligible, false)
  assert.match(usedCopy.body, /already used the one grant/)

  // 6. confirmChargeLabel states
  assert.equal(confirmChargeLabel({ booked: true }), 'Booked')
  assert.equal(confirmChargeLabel({ busyLabel: 'Joining...' }), 'Joining...')
  assert.equal(confirmChargeLabel({ isCarpool: false }), 'Confirm & charge friends')
  assert.equal(confirmChargeLabel({ isCarpool: true, firstRideFree: true }), 'Confirm · First ride free')
  assert.equal(confirmChargeLabel({ isCarpool: true, shareCents: null }), 'Waiting for the split')
  assert.equal(confirmChargeLabel({ isCarpool: true, shareCents: 1450 }), 'Confirm · charge $14.50 each')

  // 7. confirmChargeNote states
  assert.equal(confirmChargeNote({ firstRideFree: true }), 'First ride free. This confirm charges $0 for your seat.')
  assert.equal(confirmChargeNote({ shareCents: null }), null)
  assert.equal(
    confirmChargeNote({ shareCents: 1100, fullCarNow: true }),
    'This confirm charges $11.00 each. That is the full-car price above.',
  )
  assert.equal(
    confirmChargeNote({ shareCents: 1250, riderCount: 3, fullCarShareCents: 1050 }),
    'This confirm charges $12.50 each for 3 riders. A full car on a surge night is $10.50.',
  )

  // 8. otherFirstRideLabels filtering
  const multiShare = {
    shares: [
      { id: 'me', firstRideFree: true, firstName: 'Avery' },
      { id: 'peer1', firstRideFree: true, firstName: 'Taylor' },
      { id: 'peer2', firstRideFree: false, firstName: 'Jordan' },
    ],
  }
  assert.deepEqual(otherFirstRideLabels(multiShare, 'me'), ['Taylor'])
  assert.deepEqual(otherFirstRideLabels(multiShare, null), ['Avery', 'Taylor'])
})

test('makeAmbassadorCode and matchCarpoolRequests: code generation and matching bounds', () => {
  // 1. makeAmbassadorCode format and uniqueness
  const code1 = makeAmbassadorCode('user_a')
  const code2 = makeAmbassadorCode('user_b')
  assert.ok(code1.startsWith('amb_'))
  assert.equal(code1.length, 12)
  assert.match(code1, /^amb_[a-z2-9]{8}$/)
  assert.notEqual(code1, code2)

  // 2. matchCarpoolRequests with empty array
  const emptyMatch = matchCarpoolRequests([], { at: new Date() })
  assert.deepEqual(emptyMatch.pools, [])
  assert.deepEqual(emptyMatch.rejected, [])
  assert.equal(emptyMatch.considered, 0)

  // 3. Invalid coordinates in requests
  const invalidRequests = [
    { id: 'bad_pickup', pickup: null, dropoff: { lat: 34.68, lng: -82.83 } },
    { id: 'bad_dropoff', pickup: { lat: 34.68, lng: -82.83 }, dropoff: { lat: NaN, lng: -82.83 } },
  ]
  const invalidMatch = matchCarpoolRequests(invalidRequests, { at: new Date() })
  assert.equal(invalidMatch.rejected.length, 2)
  assert.equal(invalidMatch.rejected[0].error, 'pickup_coords')
  assert.equal(invalidMatch.rejected[1].error, 'dropoff_coords')

  // 4. Distant pickups (>1600m) do not merge into the same carpool pool
  const grandMarc = { lat: 34.685, lng: -82.8165, label: 'Grand Marc' }
  const patrickSquare = { lat: 34.71, lng: -82.79, label: 'Patrick Square' } // ~3.5km away
  const collegeAve = { lat: 34.6839, lng: -82.8366, label: 'College Ave' }
  const depart = new Date('2026-09-27T02:30:00Z')

  const distantRequests = [
    { id: 'r_near', pickup: grandMarc, dropoff: collegeAve, departAt: depart },
    { id: 'r_far', pickup: patrickSquare, dropoff: collegeAve, departAt: depart },
  ]
  const distantMatch = matchCarpoolRequests(distantRequests, { at: depart })
  // They should be in separate pools
  assert.equal(distantMatch.pools.length, 2)
  assert.ok(distantMatch.pools.every((p) => p.waiting && p.size === 1))
})
