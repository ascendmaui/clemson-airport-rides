import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeBonusWindow, clemsonInstant, eventAnchor, eventDemandWeight, nudgeCopy, nudgeDue, upcomingEvents } from './campusEvents.js'

test('clemsonInstant resolves Eastern wall time across DST', () => {
  assert.equal(clemsonInstant('2026-10-24', 12).toISOString(), '2026-10-24T16:00:00.000Z')
  assert.equal(clemsonInstant('2026-12-17', 9).toISOString(), '2026-12-17T14:00:00.000Z')
})

test('anchor falls back to noon ET when kickoff is TBA', () => {
  assert.equal(eventAnchor({ event_date: '2026-10-24', starts_at: null }).toISOString(), '2026-10-24T16:00:00.000Z')
  assert.equal(eventAnchor({ starts_at: '2026-10-17T16:00:00Z' }).toISOString(), '2026-10-17T16:00:00.000Z')
})

test('nudge is due inside the lead window only, once', () => {
  const e = { event_date: '2026-10-17', starts_at: '2026-10-17T16:00:00Z', nudge_lead_hours: 24 }
  assert.equal(nudgeDue(e, new Date('2026-10-16T15:59:00Z')), false)
  assert.equal(nudgeDue(e, new Date('2026-10-16T16:30:00Z')), true)
  assert.equal(nudgeDue(e, new Date('2026-10-17T16:01:00Z')), false)
  assert.equal(nudgeDue({ ...e, nudge_sent_at: '2026-10-16T16:00:00Z' }, new Date('2026-10-16T20:00:00Z')), false)
  assert.equal(nudgeDue({ ...e, active: false }, new Date('2026-10-16T20:00:00Z')), false)
})

test('nudge copy is driver supply copy with the bonus when set', () => {
  const copy = nudgeCopy({ kind: 'football_home', title: 'Football vs. Charleston Southern', event_date: '2026-10-17', starts_at: '2026-10-17T16:00:00Z', driver_bonus_cents: 300, bonus_starts_at: '2026-10-17T19:00:00Z', bonus_ends_at: '2026-10-17T23:00:00Z' })
  assert.match(copy.title, /^Home game: Football vs\. Charleston Southern/)
  assert.match(copy.body, /Sat, Oct 17 at 12:00 PM/)
  assert.match(copy.body, /\+\$3 per completed trip, 3:00 PM–7:00 PM/)
  assert.doesNotMatch(copy.body, /fare|price/i)
})

test('bonus window and demand weight', () => {
  const rows = [
    { id: 'a', driver_bonus_cents: 250, bonus_starts_at: '2026-10-17T19:00:00Z', bonus_ends_at: '2026-10-17T23:00:00Z', event_date: '2026-10-17', demand_weight: 2 },
    { id: 'b', event_date: '2026-11-25', ends_on: '2026-11-27', demand_weight: 2.5 },
  ]
  assert.equal(activeBonusWindow(rows, new Date('2026-10-17T20:00:00Z')).cents, 250)
  assert.equal(activeBonusWindow(rows, new Date('2026-10-17T23:00:00Z')), null)
  assert.equal(eventDemandWeight(rows, new Date('2026-11-26T15:00:00Z')), 2.5)
  assert.equal(eventDemandWeight(rows, new Date('2026-11-28T15:00:00Z')), 1)
  const up = upcomingEvents(rows, new Date('2026-11-20T15:00:00Z'))
  assert.deepEqual(up.map((e) => e.id), ['b'])
})

test('supply migration is additive, keeps #436 table shape, cites official sources', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012111710_clemson_events_supply.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.clemson_events/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS nudge_sent_at/)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /DROP TABLE|DROP COLUMN/i)
  assert.match(sql, /clemson_events_admin_write[\s\S]*public\.is_admin\(\)/)
  const seeds = sql.slice(sql.indexOf('INSERT INTO'), sql.indexOf('ON CONFLICT'))
  const rows = seeds.split('\n').filter((l) => l.trim().startsWith("('"))
  assert.ok(rows.length >= 14)
  for (const row of rows) assert.match(row, /'https:\/\/(clemsontigers\.com|www\.clemson\.edu)\//, row)
  assert.doesNotMatch(sql, /fare_cents|surge_multiplier/)
})
