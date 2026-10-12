import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLeaderboard, leaderboardName } from './leaderboard.js'
import { weekStartIso } from '../../server/leaderboard.js'

test('names are first name and last initial only', () => {
  assert.equal(leaderboardName('john matveyev'), 'John M.')
  assert.equal(leaderboardName('Mary Ann Smith'), 'Mary S.')
  assert.equal(leaderboardName('Kim'), 'Kim')
  assert.equal(leaderboardName(''), 'Driver')
})

test('ranks by trips and earnings and drops excluded drivers', () => {
  const t = (driver_id, fare) => ({ driver_id, status: 'completed', fare_cents: fare, metadata: {} })
  const trips = [t('a', 1000), t('a', 1000), t('b', 5000), t('c', 9000), t('sim', 99999), { ...t('b', 100), metadata: { e2e_test: true } }]
  const board = buildLeaderboard(trips, [{ id: 'a', full_name: 'Ann Lee' }, { id: 'b', full_name: 'Bo Diaz' }, { id: 'c', full_name: 'Cy Fox' }], {
    excluded: (id) => id === 'sim' || id === 'c', viewerId: 'b',
  })
  assert.deepEqual(board.byTrips.map((r) => [r.name, r.trips]), [['Ann L.', 2], ['Bo D.', 1]])
  assert.deepEqual(board.byEarnings.map((r) => [r.name, r.earningsCents]), [['Bo D.', 4000], ['Ann L.', 1600]])
  assert.equal(board.you.earnings.rank, 1)
  assert.ok(!JSON.stringify(board).includes('Diaz'))
  assert.ok(!JSON.stringify(board).includes('"b"'))
})

test('week starts Monday midnight New York (EDT and EST)', () => {
  assert.equal(weekStartIso(new Date('2026-10-14T12:00:00Z')), '2026-10-12T04:00:00.000Z')
  assert.equal(weekStartIso(new Date('2026-12-02T12:00:00Z')), '2026-11-30T05:00:00.000Z')
})
