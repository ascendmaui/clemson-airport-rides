import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CARPOOL_MAX_SEATS,
  NO_DRIVERS_AVAILABLE_COPY,
  SCHEDULE_AHEAD_DISCOUNT_PCT,
  applyScheduleAheadDiscount,
  carpoolSeatCount,
  driverQualifiesForTier,
  isBlockedRideTier,
  pickupConflicts,
  resolveOfferedTier,
  rideOptionLabel,
  scheduleAheadApplies,
  tiersFromDrivers,
  vehicleServesComfort,
} from './rideOptions.js'

const NOW = new Date('2026-10-05T15:00:00.000Z')
const LATER = new Date('2026-10-05T16:00:00.000Z')
const SOON = new Date('2026-10-05T15:10:00.000Z')

function driver(overrides) {
  return {
    id: 'd1',
    approved: true,
    online: true,
    busy: false,
    comfort: false,
    conflict: false,
    ...overrides,
  }
}

test('live tiers require an approved online driver who is not on a trip', () => {
  assert.deepEqual(tiersFromDrivers([driver()], 'now'), ['standard', 'wait', 'carpool'])
  assert.deepEqual(
    tiersFromDrivers([driver({ comfort: true })], 'now'),
    ['standard', 'wait', 'comfort', 'carpool'],
  )
  assert.deepEqual(tiersFromDrivers([driver({ online: false, comfort: true })], 'now'), [])
  assert.deepEqual(tiersFromDrivers([driver({ busy: true, comfort: true })], 'now'), [])
  assert.deepEqual(tiersFromDrivers([driver({ approved: false, comfort: true })], 'now'), [])
  assert.deepEqual(tiersFromDrivers([], 'now'), [])
})

test('scheduled tiers ignore who is online and hide a class nobody qualified can serve', () => {
  const offlineComfort = driver({ id: 'a', online: false, comfort: true })
  const standardOnly = driver({ id: 'b', online: false, comfort: false })
  assert.deepEqual(tiersFromDrivers([offlineComfort], 'scheduled'), ['standard', 'wait', 'comfort', 'carpool'])
  assert.deepEqual(tiersFromDrivers([standardOnly], 'scheduled'), ['standard', 'wait', 'carpool'])
  assert.deepEqual(
    tiersFromDrivers([offlineComfort], 'scheduled').includes('comfort'),
    true,
  )
  const booked = driver({ online: false, comfort: true, conflict: true })
  assert.deepEqual(tiersFromDrivers([booked], 'scheduled'), [])
  const other = driver({ id: 'c', online: false, comfort: false, conflict: false })
  assert.deepEqual(tiersFromDrivers([booked, other], 'scheduled'), ['standard', 'wait', 'carpool'])
})

test('comfort follows the vehicle class field, not make or model', () => {
  assert.equal(vehicleServesComfort({ service_class: 'comfort', make: 'Honda', model: 'Civic' }), true)
  assert.equal(vehicleServesComfort({ tier: 'comfort' }), true)
  assert.equal(vehicleServesComfort({ service_class: 'standard', tier: 'standard' }), false)
  assert.equal(vehicleServesComfort({ make: 'Honda', model: 'Accord' }), false)
  assert.equal(vehicleServesComfort(null), false)
})

test('retired and unknown ride options are rejected and labeled without pricing', () => {
  assert.equal(resolveOfferedTier(undefined), 'standard')
  assert.equal(resolveOfferedTier(''), 'standard')
  assert.equal(resolveOfferedTier(' Wait '), 'wait')
  assert.equal(resolveOfferedTier('comfort'), 'comfort')
  assert.equal(resolveOfferedTier('carpool'), 'carpool')
  assert.equal(rideOptionLabel('carpool'), 'Carpool')
  const blocked = ['te', 'sla'].join('')
  const blockedAuto = ['te', 'sla_self_driving'].join('')
  const blockedRobot = ['robo', 'taxi'].join('')
  assert.equal(isBlockedRideTier(blocked), true)
  assert.equal(isBlockedRideTier(blockedAuto), true)
  assert.equal(isBlockedRideTier(blockedRobot), true)
  assert.throws(() => resolveOfferedTier(blocked), /not offered/)
  assert.throws(() => resolveOfferedTier(blockedAuto), /not offered/)
  assert.throws(() => resolveOfferedTier(blockedRobot), /not offered/)
  assert.throws(() => resolveOfferedTier('xl'), /not offered/)
  assert.throws(() => resolveOfferedTier('pet'), /not offered/)
  assert.equal(rideOptionLabel(blocked), 'Retired option')
  assert.equal(rideOptionLabel('standard'), 'Standard')
  assert.equal(rideOptionLabel('xl'), 'Retired option')
})

test('schedule-ahead 10% applies only past the lead time and does not add an upfront charge', () => {
  assert.equal(scheduleAheadApplies(LATER, NOW), true)
  assert.equal(scheduleAheadApplies(SOON, NOW), false)
  const airport = applyScheduleAheadDiscount(
    { fareCents: 10000, depositCents: 2500, breakdown: { rider_pays_cents: 10000 } },
    { at: LATER, now: NOW, enabled: true },
  )
  assert.equal(airport.scheduleDiscountPct, SCHEDULE_AHEAD_DISCOUNT_PCT)
  assert.equal(airport.scheduleDiscountCents, 1000)
  assert.equal(airport.fareBeforeScheduleDiscountCents, 10000)
  assert.equal(airport.fareCents, 9000)
  assert.equal(airport.depositCents, 0)
  assert.equal(airport.breakdown.schedule_discount_cents, 1000)

  const campus = applyScheduleAheadDiscount(
    { fareCents: 2000, depositCents: 0 },
    { at: LATER, now: NOW, enabled: true },
  )
  assert.equal(campus.fareCents, 1800)
  assert.equal(campus.depositCents, 0)

  const tooSoon = applyScheduleAheadDiscount(
    { fareCents: 2000, depositCents: 2500 },
    { at: SOON, now: NOW, enabled: true },
  )
  assert.equal(tooSoon.fareCents, 2000)
  assert.equal(tooSoon.scheduleDiscountCents, 0)
  assert.equal(tooSoon.depositCents, 2500)

  const ignored = applyScheduleAheadDiscount(
    { fareCents: 2000, depositCents: 0 },
    { at: LATER, now: NOW, enabled: false },
  )
  assert.equal(ignored.fareCents, 2000)
  assert.equal(NO_DRIVERS_AVAILABLE_COPY, 'No drivers available right now')
})

test('a pickup within 45 minutes conflicts with a reservation', () => {
  assert.equal(pickupConflicts('2026-10-05T18:00:00.000Z', '2026-10-05T18:30:00.000Z'), true)
  assert.equal(pickupConflicts('2026-10-05T18:00:00.000Z', '2026-10-05T19:00:00.000Z'), false)
})

test('carpoolSeatCount enforces 1-2 seat bounds for carpool and 1 seat for other tiers', () => {
  assert.equal(CARPOOL_MAX_SEATS, 2)

  // Non-carpool tiers always return 1 seat regardless of raw input
  assert.equal(carpoolSeatCount('standard', 2), 1)
  assert.equal(carpoolSeatCount('standard', 5), 1)
  assert.equal(carpoolSeatCount('wait', 2), 1)
  assert.equal(carpoolSeatCount('comfort', 4), 1)
  assert.equal(carpoolSeatCount('', 2), 1)
  assert.equal(carpoolSeatCount(null, 2), 1)

  // Carpool tier clamps to [1, 2]
  assert.equal(carpoolSeatCount('carpool', undefined), 1)
  assert.equal(carpoolSeatCount('carpool', null), 1)
  assert.equal(carpoolSeatCount('carpool', NaN), 1)
  assert.equal(carpoolSeatCount('carpool', 'invalid'), 1)
  assert.equal(carpoolSeatCount('carpool', -5), 1)
  assert.equal(carpoolSeatCount('carpool', 0), 1)
  assert.equal(carpoolSeatCount('carpool', 1), 1)
  assert.equal(carpoolSeatCount('carpool', 2), 2)
  assert.equal(carpoolSeatCount('carpool', 3), 2)
  assert.equal(carpoolSeatCount('carpool', 4), 2)
  assert.equal(carpoolSeatCount('carpool', 100), 2)
  assert.equal(carpoolSeatCount('carpool', ' 2 '), 2)
  assert.equal(carpoolSeatCount('carpool', 1.8), 2)
})

test('driverQualifiesForTier verifies standard and carpool share the same approved driver pool', () => {
  const approved = { approved: true, suspended: false, comfort: false }
  const suspended = { approved: true, suspended: true, comfort: false }
  const unapproved = { approved: false, suspended: false, comfort: false }
  const comfortOnly = { approved: true, suspended: false, comfort: true }

  assert.equal(driverQualifiesForTier(approved, 'standard'), true)
  assert.equal(driverQualifiesForTier(approved, 'carpool'), true)
  assert.equal(driverQualifiesForTier(approved, 'wait'), true)
  assert.equal(driverQualifiesForTier(approved, 'comfort'), false)

  assert.equal(driverQualifiesForTier(comfortOnly, 'comfort'), true)
  assert.equal(driverQualifiesForTier(comfortOnly, 'carpool'), true)

  assert.equal(driverQualifiesForTier(suspended, 'carpool'), false)
  assert.equal(driverQualifiesForTier(suspended, 'standard'), false)
  assert.equal(driverQualifiesForTier(unapproved, 'carpool'), false)
})

