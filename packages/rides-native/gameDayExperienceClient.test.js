import assert from 'node:assert/strict'
import test from 'node:test'
import { loadGameDayExperience, setGameDayPrepCheck } from './gameDayExperience.js'

function client(tables, { errors = {}, writes = [] } = {}) {
  return {
    from(table) {
      const state = { filters: [], limit: null, mode: 'select', payload: null }
      const api = {
        select() { return api },
        eq(col, val) { state.filters.push([col, val]); return api },
        limit(n) { state.limit = n; return api },
        upsert(payload, options) {
          state.mode = 'upsert'
          state.payload = payload
          writes.push({ table, op: 'upsert', payload, options })
          return Promise.resolve(errors[table] ? { data: null, error: errors[table] } : { data: payload, error: null })
        },
        delete() {
          state.mode = 'delete'
          writes.push({ table, op: 'delete', filters: state.filters })
          return api
        },
        then(resolve, reject) {
          if (state.mode === 'delete') {
            const result = errors[table] ? { data: null, error: errors[table] } : { data: null, error: null }
            return Promise.resolve(result).then(resolve, reject)
          }
          if (errors[table]) return Promise.resolve({ data: null, error: errors[table] }).then(resolve, reject)
          let rows = [...(tables[table] || [])]
          for (const [col, val] of state.filters) rows = rows.filter((row) => row[col] === val)
          if (state.limit) rows = rows.slice(0, state.limit)
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return api
    },
  }
}

const LIVE = new Date('2026-10-14T19:00:00.000Z')
const AFTER = new Date('2026-10-14T23:30:00.000Z')

test('loadGameDayExperience reads the schedule, zones, queue, prep, and optional feeds', async () => {
  const supabase = client({
    game_day_events: [{
      id: 'game-1',
      title: 'Home game',
      active: true,
      starts_at: '2026-10-14T18:00:00.000Z',
      ends_at: '2026-10-14T23:00:00.000Z',
      surge_multiplier: 2,
      pickup_zone_label: 'North plaza',
    }],
    game_day_zones: [
      { id: 'z1', event_id: null, active: true, kind: 'pickup', name: 'North plaza', instructions: 'Outer curb.', walk_minutes: 4, sort_order: 1 },
    ],
    game_day_zone_windows: [
      { id: 'w1', active: true, label: 'Final whistle', offset_start_minutes: 0, offset_end_minutes: 30, heat: 'peak', note: 'Queue opens.', sort_order: 1 },
    ],
    game_day_prep_items: [
      { id: 'charge', active: true, title: 'Charge', detail: 'Full battery.', sort_order: 1 },
    ],
    game_day_prep_checks: [
      { driver_id: 'driver-1', event_id: 'game-1', item_id: 'charge' },
    ],
    game_day_pickup_queue: [{
      event_id: 'game-1',
      status: 'busy',
      riders_waiting: 20,
      drivers_staged: 3,
      wait_minutes: 18,
      updated_at: AFTER.toISOString(),
    }],
    clemson_events: [{ id: 'cal', active: true, kind: 'football_home', title: 'Later', event_date: '2026-10-24' }],
    driver_perk_config: [{ key: 'game_day_surge', value: { enabled: true, driverBonusCents: 300, zoneBoost: 1 } }],
  })
  const live = await loadGameDayExperience(supabase, { driverId: 'driver-1', now: LIVE })
  assert.equal(live.model.eventId, 'game-1')
  assert.equal(live.model.phase, 'live')
  assert.equal(live.model.surge.multiplierLabel, '1.25×') // event 2x is capped at 1.25x
  assert.equal(live.model.zones.pickups[0].name, 'North plaza')
  assert.equal(live.model.prep.items[0].checked, true)
  assert.equal(live.model.queue.status, 'closed')
  assert.match(live.model.surge.driverBonusLabel, /\$3/)
  assert.equal(live.model.timeline.windows[0].label, 'Final whistle')

  const after = await loadGameDayExperience(supabase, { driverId: 'driver-1', now: AFTER })
  assert.equal(after.model.phase, 'postgame')
  assert.equal(after.model.queue.status, 'busy')
  assert.equal(after.model.queue.waitLabel, '18 min')
})

test('missing optional tables fall back to the standing guide', async () => {
  const supabase = client({}, { errors: { clemson_events: { message: 'missing' }, driver_perk_config: { message: 'missing' }, game_day_zones: { message: 'missing' } } })
  const { model } = await loadGameDayExperience(supabase, { now: LIVE })
  assert.equal(model.phase, 'off')
  assert.equal(model.zones.pickups.length, 2)
  assert.equal(model.prep.total, 5)
  assert.equal(model.surge.driverBonusLabel, null)
})

test('prep checks upsert and delete through the client', async () => {
  const writes = []
  const supabase = client({}, { writes })
  const saved = await setGameDayPrepCheck(supabase, { driverId: 'd', eventId: 'e', itemId: 'charge', checked: true })
  assert.equal(saved.persisted, true)
  assert.equal(writes[0].op, 'upsert')
  assert.equal(writes[0].payload.item_id, 'charge')
  const removed = await setGameDayPrepCheck(supabase, { driverId: 'd', eventId: 'e', itemId: 'charge', checked: false })
  assert.equal(removed.persisted, true)
  assert.equal(writes[1].op, 'delete')
  const skipped = await setGameDayPrepCheck(null, { driverId: 'd', eventId: 'e', itemId: 'charge', checked: true })
  assert.equal(skipped.persisted, false)
})
