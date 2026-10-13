import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptanceRate, completionRate, resolveMarker, unlockedItems, DEFAULT_SCORECARD_CONFIG } from './scorecard.js'

const now = Date.parse('2026-10-12T12:00:00Z')
const day = (n) => new Date(now - n * 86400_000).toISOString()

test('acceptance: window of 30 days, capped at last 100 offers, one per trip', () => {
  const offers = [{ tripId: 'a', at: day(1) }, { tripId: 'a', at: day(1) }, { tripId: 'b', at: day(2) }, { tripId: 'c', at: day(3) }, { tripId: 'old', at: day(40) }]
  const r = acceptanceRate(offers, new Set(['a', 'old']), { now })
  assert.deepEqual([r.offered, r.accepted], [3, 1])
  assert.equal(Math.round(r.rate * 1000), 333)
  const many = Array.from({ length: 150 }, (_, i) => ({ tripId: `t${i}`, at: new Date(now - i * 60_000).toISOString() }))
  const capped = acceptanceRate(many, new Set(['t0', 't149']), { now })
  assert.deepEqual([capped.offered, capped.accepted], [100, 1])
  assert.equal(acceptanceRate([], new Set(), { now }).rate, null)
})

test('completion excludes rider cancels and counts driver cancels against', () => {
  const r = completionRate({ accepted: 22, completed: 18, riderCancels: 2, driverCancels: 2 })
  assert.deepEqual([r.completed, r.eligible], [18, 20])
  assert.equal(r.rate, 0.9)
  assert.equal(completionRate({ accepted: 3, completed: 0, riderCancels: 3 }).rate, null)
})

test('milestones unlock at 50/100/250/500 trips, 4.9 rating (5+ ratings), 95% completion (20+ trips)', () => {
  const base = { lifetimeTrips: 120, rating: 4.92, ratingCount: 30, completion: { rate: 0.96, eligible: 25 }, acceptance: { rate: 0.8, offered: 40 } }
  const { milestones, unlocked } = unlockedItems(base, DEFAULT_SCORECARD_CONFIG)
  assert.deepEqual(milestones.filter((m) => m.reached).map((m) => m.id), ['trips_50', 'trips_100', 'rating_49', 'completion_95'])
  assert.ok(unlocked.includes('icon:car_sport') && unlocked.includes('livery:checkered') && !unlocked.includes('icon:paw'))
  const fewRatings = unlockedItems({ ...base, ratingCount: 3, completion: { rate: 1, eligible: 5 } }, DEFAULT_SCORECARD_CONFIG)
  assert.ok(!fewRatings.milestones.find((m) => m.id === 'rating_49').reached)
  assert.ok(!fewRatings.milestones.find((m) => m.id === 'completion_95').reached)
  const custom = unlockedItems({ ...base, lifetimeTrips: 5 }, { milestones: [{ id: 'x', metric: 'trips', threshold: 5, unlocks: ['icon:paw'] }] })
  assert.ok(custom.unlocked.includes('icon:paw'))
})

test('locked or unknown marker choices fall back to the default', () => {
  const unlocked = ['color:default', 'icon:car', 'color:tiger_orange']
  assert.equal(resolveMarker({ style: 'color:tiger_orange', icon: 'icon:paw' }, unlocked).icon, 'icon:car')
  assert.equal(resolveMarker({ style: 'color:tiger_orange', icon: 'icon:car' }, unlocked).fill, '#E85D04')
  assert.equal(resolveMarker({ style: 'livery:nope' }, unlocked).style, 'color:default')
  assert.equal(resolveMarker(null).glyph, 'car')
})

test('marker never reaches matching code', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['../../server/autoAssign.js', '../../server/dispatchBoost.js', '../../server/authoritativeFare.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /map_marker|scorecard|resolveMarker/)
  }
})
