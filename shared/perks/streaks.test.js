import assert from 'node:assert/strict'
import test from 'node:test'
import { dayStreak, normalizeStreakConfig, streakProgress, tripStreak } from './streaks.js'
import { nyDayOf, nyWeekStartDay, prevDay } from './time.js'

const D = 'drv'
const done = (id, at) => ({ id, driver_id: D, status: 'completed', completed_at: at, metadata: {} })
const cancel = (id, at) => ({ id, driver_id: null, status: 'searching', metadata: { driver_cancels: [{ driver_id: D, at }] } })

test('NY time helpers', () => {
  assert.equal(nyDayOf('2026-10-13T03:30:00Z'), '2026-10-12')
  assert.equal(prevDay('2026-03-01'), '2026-02-28')
  assert.equal(nyWeekStartDay(new Date('2026-10-18T15:00:00Z')), '2026-10-12')
  assert.equal(nyWeekStartDay(new Date('2026-10-12T05:00:00Z')), '2026-10-12')
})

test('trip streak resets on a driver cancel and awards each multiple', () => {
  const trips = [
    done('a', '2026-10-01T10:00:00Z'), done('b', '2026-10-01T11:00:00Z'),
    cancel('x', '2026-10-01T12:00:00Z'),
    done('c', '2026-10-02T10:00:00Z'), done('d', '2026-10-02T11:00:00Z'), done('e', '2026-10-02T12:00:00Z'), done('f', '2026-10-02T13:00:00Z'),
  ]
  const s = tripStreak(trips, D, 2)
  assert.equal(s.current, 4)
  assert.deepEqual(s.awards.map((a) => a.ref), ['trip:b', 'trip:d', 'trip:f'])
  // Other drivers' cancels don't count.
  const other = [...trips, { id: 'y', metadata: { driver_cancels: [{ driver_id: 'someone', at: '2026-10-02T12:30:00Z' }] } }]
  assert.equal(tripStreak(other, D, 2).current, 4)
})

test('day streak counts consecutive NY days and dies after a gap', () => {
  const trips = [
    done('a', '2026-10-05T14:00:00Z'), done('b', '2026-10-06T14:00:00Z'),
    done('c', '2026-10-08T03:00:00Z'), // 11 PM Oct 7 NY
    done('d', '2026-10-08T14:00:00Z'),
  ]
  const now = new Date('2026-10-09T14:00:00Z')
  const s = dayStreak(trips, D, 2, now)
  assert.equal(s.current, 4)
  assert.deepEqual(s.awards.map((a) => a.ref), ['days:2026-10-06', 'days:2026-10-08'])
  assert.equal(dayStreak(trips, D, 2, new Date('2026-10-11T14:00:00Z')).current, 0)
})

test('awards respect startsAt (no retroactive pay) and config toggles', () => {
  const trips = Array.from({ length: 10 }, (_, i) => done(`t${i}`, `2026-10-0${Math.floor(i / 5) + 1}T1${i % 5}:00:00Z`))
  const cfg = { startsAt: '2026-10-02T00:00:00Z', trips: { target: 5, bonusCents: 500 }, days: { target: 2, bonusCents: 700 } }
  const p = streakProgress(trips, D, cfg, new Date('2026-10-02T20:00:00Z'))
  assert.deepEqual(p.awards.map((a) => [a.kind, a.ref, a.amountCents]), [['streak_trips', 'trip:t9', 500], ['streak_days', 'days:2026-10-02', 700]])
  assert.equal(p.trips.current, 10)
  assert.equal(p.trips.toNext, 5)
  assert.equal(streakProgress(trips, D, { ...cfg, startsAt: undefined }).awards.length, 0)
  assert.equal(streakProgress(trips, D, { ...cfg, enabled: false }).awards.length, 0)
  assert.equal(normalizeStreakConfig({ trips: { target: 0 } }).trips.target, 10)
})
