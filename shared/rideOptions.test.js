import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NO_DRIVERS_AVAILABLE_COPY,
  SCHEDULE_AHEAD_DISCOUNT_PCT,
  applyScheduleAheadDiscount,
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
