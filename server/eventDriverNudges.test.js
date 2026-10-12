import test from 'node:test'
import assert from 'node:assert/strict'
import { sweepEventDriverNudges } from './eventDriverNudges.js'

function fakeSb(rows) {
  const claimed = []
  return {
    claimed,
    from(table) {
      assert.equal(table, 'clemson_events')
      const q = { mode: 'select', filters: {} }
      const chain = {
        select() { return chain },
        eq(k, v) { q.filters[k] = v; return chain },
        is() { return chain },
        gte() { return chain },
        lte() { return chain },
        limit() { return Promise.resolve({ data: rows, error: null }) },
        update(patch) { q.mode = 'update'; q.patch = patch; return chain },
      }
      chain.select = () => {
        if (q.mode === 'update') {
          const row = rows.find((r) => r.id === q.filters.id)
          if (!row || row.nudge_sent_at) return Promise.resolve({ data: [], error: null })
          row.nudge_sent_at = q.patch.nudge_sent_at
          claimed.push(row.id)
          return Promise.resolve({ data: [{ id: row.id }], error: null })
        }
        return chain
      }
      return chain
    },
  }
}

test('sends one nudge per due event and claims it first', async () => {
  const rows = [
    { id: 'game', kind: 'football_home', title: 'Football vs. Charleston Southern', event_date: '2026-10-17', starts_at: '2026-10-17T16:00:00Z', active: true, nudge_lead_hours: 24, nudge_sent_at: null },
    { id: 'later', kind: 'graduation', title: 'Winter commencement', event_date: '2026-12-17', starts_at: '2026-12-17T14:00:00Z', active: true, nudge_lead_hours: 24, nudge_sent_at: null },
  ]
  const sb = fakeSb(rows)
  const pushes = []
  const deps = { now: new Date('2026-10-16T18:00:00Z'), drivers: async () => ['d1', 'd2'], push: async (_sb, ids, msg) => { pushes.push({ ids, msg }); return { sent: ids.length } } }
  const out = await sweepEventDriverNudges(sb, deps)
  assert.deepEqual(out.nudged, ['game'])
  assert.deepEqual(sb.claimed, ['game'])
  assert.equal(pushes.length, 1)
  assert.deepEqual(pushes[0].ids, ['d1', 'd2'])
  assert.equal(pushes[0].msg.data.type, 'campus_event')
  const again = await sweepEventDriverNudges(sb, deps)
  assert.deepEqual(again.nudged, [])
  assert.equal(pushes.length, 1)
})

test('dry run sends nothing', async () => {
  const rows = [{ id: 'game', kind: 'football_home', title: 'x game', event_date: '2026-10-17', starts_at: '2026-10-17T16:00:00Z', active: true, nudge_lead_hours: 24, nudge_sent_at: null }]
  const sb = fakeSb(rows)
  const out = await sweepEventDriverNudges(sb, { now: new Date('2026-10-16T18:00:00Z'), dryRun: true, drivers: async () => ['d1'], push: async () => { throw new Error('no') } })
  assert.equal(out.due, 1)
  assert.deepEqual(sb.claimed, [])
})
