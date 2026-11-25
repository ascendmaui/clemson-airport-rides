import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { driverSafetyScores } from './safetyScore.js'

function mockSb({ enabled = true, failDriver = null } = {}) {
  const stats = { configLoads: 0, inFlight: 0, maxInFlight: 0, queries: 0 }
  function from(table) {
    const filters = {}
    const api = {
      select() { return api },
      eq(col, val) { filters[col] = val; return api },
      gte() { return api },
      in() { return api },
      order() { return api },
      limit() { return api },
      contains() { return api },
      maybeSingle: async () => {
        stats.configLoads++
        return { data: { value: { enabled } }, error: null }
      },
      then(resolve, reject) {
        stats.queries++
        stats.inFlight++
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
        return new Promise((r) => setTimeout(r, 5)).then(() => {
          stats.inFlight--
          if (failDriver && (filters.driver_id === failDriver || filters.ratee_id === failDriver)) throw new Error('boom')
          return { data: [], error: null, count: 0 }
        }).then(resolve, reject)
      },
    }
    return api
  }
  return { sb: { from }, stats }
}

test('driverSafetyScores loads config once and scores drivers concurrently', async () => {
  const { sb, stats } = mockSb()
  const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10']
  const scores = await driverSafetyScores(sb, ids)
  assert.equal(stats.configLoads, 1)
  assert.equal(scores.size, 10)
  assert.ok(stats.maxInFlight > 4, `expected concurrent reads, saw ${stats.maxInFlight}`)
  for (const id of ids) assert.ok(scores.get(id) && typeof scores.get(id) === 'object')
})

test('driverSafetyScores reuses a passed config and skips the config read', async () => {
  const { sb, stats } = mockSb()
  await driverSafetyScores(sb, ['d1', 'd1', 'd2'], { config: { enabled: true } })
  assert.equal(stats.configLoads, 0)
})

test('driverSafetyScores maps a failed driver to null without failing the rest', async () => {
  const { sb } = mockSb({ failDriver: 'bad' })
  const scores = await driverSafetyScores(sb, ['ok', 'bad'], { config: { enabled: true } })
  assert.equal(scores.get('bad'), null)
  assert.ok(scores.get('ok'))
})

test('driverSafetyScores returns enabled:false for every driver when the score is off', async () => {
  const { sb, stats } = mockSb({ enabled: false })
  const scores = await driverSafetyScores(sb, ['a', 'b'])
  assert.deepEqual(scores.get('a'), { enabled: false })
  assert.equal(stats.queries, 0)
})

test('dispatch boost no longer awaits safety scores one driver at a time', () => {
  const src = readFileSync(new URL('./dispatchBoost.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /for \(const d of drivers[^\n]*await driverSafetyScore\(/)
  assert.match(src, /driverSafetyScores\(sb, drivers\.slice\(0, 10\)/)
})
