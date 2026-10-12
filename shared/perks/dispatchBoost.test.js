import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDispatchBoosts, priorityBoost } from './dispatchBoost.js'
import { boostAssignableDrivers, isFakeDriver } from '../../server/dispatchBoost.js'

const cfg = { enabled: true, minRating: 4.9, minRatingCount: 5, minTrips: 25, boost: 1 }

test('priority requires rating >= 4.9, enough ratings and trips', () => {
  assert.equal(priorityBoost('a', { rating: 4.9, ratingCount: 5, trips: 25 }, cfg), 1)
  assert.equal(priorityBoost('a', { rating: 4.89, ratingCount: 50, trips: 99 }, cfg), 0)
  assert.equal(priorityBoost('a', { rating: 5, ratingCount: 4, trips: 99 }, cfg), 0)
  assert.equal(priorityBoost('a', { rating: 5, ratingCount: 9, trips: 24 }, cfg), 0)
  assert.equal(priorityBoost('a', { rating: 5, ratingCount: 9, trips: 99 }, { ...cfg, enabled: false }), 0)
})

test('demo, simulated and busy-roster cars never get a boost', () => {
  const s = { rating: 5, ratingCount: 99, trips: 999 }
  assert.equal(priorityBoost('sim-busy-1', s, cfg, isFakeDriver), 0)
  assert.equal(isFakeDriver('sim-busy-3'), true)
  assert.equal(isFakeDriver('00000000-0000-0000-0000-000000000123'), false)
})

test('boost reorders only within a dispatch-rank tier', () => {
  const drivers = [{ id: 'john', dispatchRank: 0 }, { id: 'kim', dispatchRank: 1 }, { id: 'x', dispatchRank: 2 }, { id: 'top', dispatchRank: 2 }, { id: 'y', dispatchRank: 2 }]
  const out = applyDispatchBoosts(drivers, (d) => (d.id === 'top' || d.id === 'kim' ? 1 : 0))
  assert.deepEqual(out.map((d) => d.id), ['john', 'kim', 'top', 'x', 'y'])
  assert.deepEqual(applyDispatchBoosts(drivers, () => 0).map((d) => d.id), drivers.map((d) => d.id))
})

test('missing config or failing reads leave the order unchanged', async () => {
  const drivers = [{ id: 'a', dispatchRank: 2 }, { id: 'b', dispatchRank: 2 }]
  const none = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
  assert.deepEqual(await boostAssignableDrivers(none, drivers), drivers)
  assert.deepEqual(await boostAssignableDrivers({ from: () => { throw new Error('x') } }, drivers), drivers)
})

test('enabled config boosts the top-rated real driver', async () => {
  const drivers = [{ id: 'a', dispatchRank: 2 }, { id: 'b', dispatchRank: 2 }]
  const sb = {
    from: (table) => {
      const q = {
        select: () => q, eq: () => q, in: () => q,
        maybeSingle: async () => ({ data: { value: cfg } }),
        limit: async () => ({ data: Array.from({ length: 30 }, () => ({ driver_id: 'b' })) }),
        then: (r) => r({ data: [{ id: 'a', rating_avg: 4.95, rating_count: 40 }, { id: 'b', rating_avg: 4.95, rating_count: 40 }] }),
      }
      if (table === 'trips') q.eq = () => q
      return q
    },
  }
  assert.deepEqual((await boostAssignableDrivers(sb, drivers)).map((d) => d.id), ['b', 'a'])
})
