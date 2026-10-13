import assert from 'node:assert/strict'
import test from 'node:test'
import { firstRideChipCopy, firstRideDaily, normalizeFirstRideConfig } from './firstRide.js'

const D = 'drv-1'
const cfg = { enabled: true, startsAt: '2026-10-01T00:00:00Z', bonusCents: 500 }
const done = (id, at, extra = {}) => ({ id, driver_id: D, status: 'completed', completed_at: at, metadata: {}, ...extra })

test('default bonus is $5 and a missing startsAt pays nothing', () => {
  assert.equal(normalizeFirstRideConfig({}).bonusCents, 500)
  assert.equal(normalizeFirstRideConfig({ bonusCents: 0 }).bonusCents, 0)
  assert.equal(normalizeFirstRideConfig({ bonusCents: 750 }).bonusCents, 750)
  const now = new Date('2026-10-12T16:00:00Z')
  const hidden = firstRideDaily([done('a', '2026-10-12T15:00:00Z')], D, {}, now)
  assert.equal(hidden.awards.length, 0)
  assert.equal(hidden.available, false)
  assert.equal(hidden.earned, false)
  assert.equal(firstRideChipCopy(hidden), null)
})

test('awards the first completed NY-day trip once, with an idempotent ref', () => {
  const trips = [
    done('later', '2026-10-12T18:00:00Z'),
    done('first', '2026-10-12T15:00:00Z'),
    done('next', '2026-10-13T15:00:00Z'),
    done('other-driver', '2026-10-12T14:00:00Z', { driver_id: 'someone-else' }),
  ]
  const now = new Date('2026-10-13T16:00:00Z')
  const view = firstRideDaily(trips, D, cfg, now)
  assert.deepEqual(view.awards.map((a) => [a.kind, a.ref, a.amountCents, a.tripId]), [
    ['first_ride_daily', 'drv-1:2026-10-12', 500, 'first'],
    ['first_ride_daily', 'drv-1:2026-10-13', 500, 'next'],
  ])
  assert.equal(view.earned, true)
  assert.equal(view.available, false)
  assert.deepEqual(firstRideChipCopy(view), {
    title: 'First ride today: +$5',
    line: 'Earned',
    tone: 'orange',
  })
})

test('NY midnight keeps the late trip on the previous calendar day', () => {
  // 03:30Z is 11:30pm the previous day in America/New_York during EDT.
  const trips = [
    done('late', '2026-10-13T03:30:00Z'),
    done('morning', '2026-10-13T12:00:00Z'),
  ]
  const view = firstRideDaily(trips, D, cfg, new Date('2026-10-13T16:00:00Z'))
  assert.deepEqual(view.awards.map((a) => [a.ref, a.tripId]), [
    ['drv-1:2026-10-12', 'late'],
    ['drv-1:2026-10-13', 'morning'],
  ])
})

test('canceled and e2e trips do not earn or use up the day', () => {
  const trips = [
    { id: 'c', driver_id: D, status: 'canceled', canceled_at: '2026-10-12T14:00:00Z', completed_at: null, metadata: {} },
    { id: 'm', driver_id: D, status: 'canceled_midride', canceled_at: '2026-10-12T14:30:00Z', completed_at: '2026-10-12T14:30:00Z', metadata: {} },
    { id: 'w', driver_id: D, status: 'cancelled_wait', canceled_at: '2026-10-12T15:00:00Z', completed_at: '2026-10-12T15:00:00Z', metadata: {} },
    done('e2e', '2026-10-12T16:00:00Z', { metadata: { e2e_test: true } }),
    done('stamped', '2026-10-12T16:30:00Z', { canceled_at: '2026-10-12T16:40:00Z' }),
  ]
  const now = new Date('2026-10-12T18:00:00Z')
  const open = firstRideDaily(trips, D, cfg, now)
  assert.equal(open.awards.length, 0)
  assert.equal(open.available, true)
  assert.equal(open.earned, false)
  assert.deepEqual(firstRideChipCopy(open), {
    title: 'First ride today: +$5',
    line: 'Still available',
    tone: 'purple',
  })
  const earned = firstRideDaily([...trips, done('real', '2026-10-12T17:00:00Z')], D, cfg, now)
  assert.deepEqual(earned.awards.map((a) => a.tripId), ['real'])
  assert.equal(earned.earned, true)
})

test('startsAt blocks retroactive days and a first ride that already happened today', () => {
  const trips = [
    done('old', '2026-10-10T15:00:00Z'),
    done('earlier-today', '2026-10-12T14:00:00Z'),
  ]
  const startsAt = '2026-10-12T15:00:00Z'
  const now = new Date('2026-10-12T18:00:00Z')
  const view = firstRideDaily(trips, D, { ...cfg, startsAt }, now)
  assert.equal(view.awards.length, 0)
  assert.equal(view.earned, false)
  assert.equal(view.available, false)
  assert.equal(firstRideChipCopy(view), null)
  const later = firstRideDaily([...trips, done('second', '2026-10-12T16:00:00Z')], D, { ...cfg, startsAt }, now)
  assert.equal(later.awards.length, 0)
})

test('disabled config and a custom amount', () => {
  const trips = [done('a', '2026-10-12T15:00:00Z')]
  const now = new Date('2026-10-12T18:00:00Z')
  assert.equal(firstRideDaily(trips, D, { ...cfg, enabled: false }, now).awards.length, 0)
  const custom = firstRideDaily([], D, { ...cfg, bonusCents: 750 }, now)
  assert.equal(custom.available, true)
  assert.equal(firstRideChipCopy(custom).title, 'First ride today: +$7.50')
  assert.equal(firstRideChipCopy(firstRideDaily(trips, D, { ...cfg, bonusCents: 750 }, now)).title, 'First ride today: +$7.50')
})
