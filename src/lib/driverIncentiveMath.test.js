import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_WINDOWS,
  activeIncentiveBanner,
  activeIncentives,
  computeIncentivePayout,
  incentiveMatches,
  isIncentiveAdmin,
  splitFare,
  zonedLocalToUtc,
} from './driverIncentiveMath.js'

const thursday = DEFAULT_WINDOWS[0]
const friday = DEFAULT_WINDOWS[1]
const saturday = DEFAULT_WINDOWS[2]
const gameDay = DEFAULT_WINDOWS[3]

function at(local) {
  return zonedLocalToUtc(local, 'America/New_York')
}

test('Thursday 8pm ET is 23:00 UTC during EDT', () => {
  assert.equal(at('2026-09-24T19:00').toISOString(), '2026-09-24T23:00:00.000Z')
})

test('default nights match only their own window, including the midnight wrap', () => {
  const thu8 = at('2026-09-24T20:00')
  assert.equal(incentiveMatches(thursday, thu8), true)
  assert.equal(incentiveMatches(friday, thu8), false)
  assert.equal(incentiveMatches(saturday, thu8), false)

  const fri130 = at('2026-09-25T01:30')
  assert.equal(incentiveMatches(thursday, fri130), true)
  assert.equal(incentiveMatches(friday, fri130), false)

  const fri8 = at('2026-09-25T20:00')
  assert.equal(incentiveMatches(friday, fri8), true)
  assert.equal(incentiveMatches(thursday, fri8), false)

  const sun1 = at('2026-09-27T01:00')
  assert.equal(incentiveMatches(saturday, sun1), true)
  assert.equal(incentiveMatches(friday, sun1), false)

  const wed9 = at('2026-09-23T21:00')
  assert.equal(activeIncentives(DEFAULT_WINDOWS, wed9).length, 0)
})

test('game day auto-detect is separate from an admin-scheduled block', () => {
  const wedNoon = at('2026-09-23T12:00')
  assert.equal(incentiveMatches(gameDay, wedNoon, { gameDayActive: false }), false)
  assert.equal(incentiveMatches(gameDay, wedNoon, { gameDayActive: true }), true)

  const scheduled = {
    ...gameDay,
    id: 'sched',
    starts_at: at('2026-10-03T11:00').toISOString(),
    ends_at: at('2026-10-03T23:30').toISOString(),
  }
  assert.equal(incentiveMatches(scheduled, at('2026-10-03T18:00'), { gameDayActive: false }), true)
  assert.equal(incentiveMatches(scheduled, at('2026-10-04T12:00'), { gameDayActive: false }), false)
})

test('20% platform fee comes off rider gross; 1.5x boosts driver net only', () => {
  assert.deepEqual(splitFare(10000), {
    grossFareCents: 10000,
    platformFeeCents: 2000,
    driverNetCents: 8000,
  })
  const payout = computeIncentivePayout({
    grossFareCents: 10000,
    incentives: [{ ...thursday, id: 'thu' }],
    startedAt: '2026-09-24T23:00:00.000Z',
    completedAt: '2026-09-25T00:00:00.000Z',
  })
  assert.equal(payout.driverNetCents, 8000)
  assert.equal(payout.incentiveExtraCents, 4000)
  assert.equal(payout.driverPayoutCents, 12000)
  assert.equal(payout.driverIncentiveMultiplier, 1.5)
  assert.equal(payout.incentiveBasis, 'driver_net')
})

test('game-day bonus stacks on top of a night multiplier', () => {
  const payout = computeIncentivePayout({
    grossFareCents: 7500,
    incentives: [
      { ...thursday, id: 'thu' },
      { ...gameDay, id: 'game' },
    ],
    startedAt: '2026-09-24T23:00:00.000Z',
    completedAt: '2026-09-24T23:40:00.000Z',
  })
  assert.equal(payout.platformFeeCents, 1500)
  assert.equal(payout.driverNetCents, 6000)
  assert.equal(payout.lines.find((l) => l.incentiveId === 'thu').extraCents, 3000)
  assert.equal(payout.lines.find((l) => l.incentiveId === 'game').extraCents, 500)
  assert.equal(payout.incentiveExtraCents, 3500)
  assert.equal(payout.driverPayoutCents, 9500)
})

test('hourly guarantee tops up only the shortfall and does not double-pay', () => {
  const low = computeIncentivePayout({
    grossFareCents: 1000,
    incentives: [{ id: 'hr', name: 'Floor', type: 'hourly_guarantee', value: 4000 }],
    startedAt: '2026-09-25T23:00:00.000Z',
    completedAt: '2026-09-26T00:00:00.000Z',
  })
  assert.equal(low.driverNetCents, 800)
  assert.equal(low.incentiveExtraCents, 3200)
  assert.equal(low.driverPayoutCents, 4000)

  const alreadyAbove = computeIncentivePayout({
    grossFareCents: 10000,
    incentives: [{ id: 'hr', name: 'Floor', type: 'hourly_guarantee', value: 2000 }],
    startedAt: '2026-09-25T23:00:00.000Z',
    completedAt: '2026-09-25T23:30:00.000Z',
  })
  assert.equal(alreadyAbove.incentiveExtraCents, 0)
})

test('banner copy names the driver boost, not rider surge', () => {
  assert.equal(
    activeIncentiveBanner([{ ...thursday, id: 'thu' }]),
    'Tonight: 1.5x earnings on all rides',
  )
  assert.match(activeIncentiveBanner([gameDay]), /bonus on every ride/)
  assert.doesNotMatch(activeIncentiveBanner(DEFAULT_WINDOWS.slice(0, 1)), /surge/i)
})

test('admin gate is john@gmail.com, is_admin, or admin/ops role', () => {
  assert.equal(isIncentiveAdmin({ email: 'John@gmail.com' }, null), true)
  assert.equal(isIncentiveAdmin({ email: 'ada@clemson.edu' }, { role: 'driver' }), false)
  assert.equal(isIncentiveAdmin({ email: 'ada@clemson.edu' }, { role: 'admin' }), true)
  assert.equal(isIncentiveAdmin({ email: 'ada@clemson.edu' }, { is_admin: true }), true)
})
