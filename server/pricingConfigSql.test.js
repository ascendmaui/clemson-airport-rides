import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { COMPETITOR_RATES } from '../shared/data/competitorRates.js'
import { CLEMSON_HOME_FOOTBALL } from '../shared/data/clemsonHomeFootball.js'
import { FARE_CARD } from '../src/lib/fareRates.js'

const migration = readFileSync(new URL('../supabase/migrations/20261017120000_pricing_config_gameday.sql', import.meta.url), 'utf8')

async function fixture(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(migration)
  await db.exec(migration) // re-runnable
  return db
}

test('seeds match the in-repo seeds and re-running adds nothing', async (t) => {
  const db = await fixture(t)
  const games = (await db.query("SELECT game_date::text AS d, opponent, kickoff_et::text AS k, kickoff_tba FROM clemson_home_games ORDER BY game_date")).rows
  assert.deepEqual(games.map((g) => g.d), CLEMSON_HOME_FOOTBALL.map((g) => g.date))
  assert.equal(games[0].k, '12:00:00')
  assert.deepEqual(games.map((g) => g.kickoff_tba), [false, true, true, true])
  const card = (await db.query('SELECT * FROM pricing_rate_cards')).rows
  assert.equal(card.length, 1)
  assert.deepEqual(
    [card[0].base_cents, card[0].booking_fee_cents, card[0].per_mile_cents, card[0].per_minute_cents, card[0].min_fare_cents],
    [FARE_CARD.baseCents, FARE_CARD.bookingFeeCents, FARE_CARD.perMileCents, FARE_CARD.perMinuteCents, FARE_CARD.minFareCents],
  )
  const comps = (await db.query('SELECT * FROM competitor_rate_cards ORDER BY competitor, tier')).rows
  assert.equal(comps.length, COMPETITOR_RATES.length)
  for (const c of COMPETITOR_RATES) {
    const row = comps.find((r) => r.tier === c.tier)
    assert.equal(row.per_mile_cents, c.perMileCents, c.tier)
    assert.equal(row.min_fare_cents, c.minFareCents, c.tier)
    assert.equal(row.min_includes_booking, c.minIncludesBooking, c.tier)
    assert.equal(row.source_url, c.sourceUrl, c.tier)
  }
  const s = (await db.query('SELECT * FROM pricing_settings')).rows
  assert.equal(s.length, 1)
  assert.equal(Number(s[0].target_margin_pct), 15)
  assert.equal(s[0].overhead_cents_per_ride, 75)
  assert.equal(Number(s[0].game_day_multiplier), 1.25)
  assert.equal(Number(s[0].weekend_multiplier), 1)
})

test('every config change is audited with before/after; no-op updates are not', async (t) => {
  const db = await fixture(t)
  const before = Number((await db.query('SELECT count(*) AS n FROM pricing_config_audit')).rows[0].n)
  assert.equal(before, 1 + 1 + 4 + 4, 'seed inserts audited once')
  await db.query("UPDATE pricing_rate_cards SET per_mile_cents = 109, updated_by = 'test', change_reason = 'undercut' WHERE tier = 'standard'")
  await db.query("UPDATE pricing_rate_cards SET per_mile_cents = 109 WHERE tier = 'standard'")
  const rows = (await db.query("SELECT * FROM pricing_config_audit WHERE action = 'UPDATE'")).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].table_name, 'pricing_rate_cards')
  assert.equal(rows[0].row_key, 'standard')
  assert.equal(rows[0].old_row.per_mile_cents, 114)
  assert.equal(rows[0].new_row.per_mile_cents, 109)
  assert.equal(rows[0].changed_by, 'test')
  assert.equal(rows[0].change_reason, 'undercut')
})

test('guard rails: no carpool card, no surge over 1.25x, one settings row', async (t) => {
  const db = await fixture(t)
  await assert.rejects(db.query("INSERT INTO pricing_rate_cards (tier, base_cents, booking_fee_cents, per_mile_cents, per_minute_cents, min_fare_cents) VALUES ('carpool', 1, 1, 1, 1, 200)"))
  await assert.rejects(db.query('UPDATE pricing_settings SET game_day_multiplier = 1.5'))
  await assert.rejects(db.query('UPDATE pricing_settings SET weekend_multiplier = 1.3'))
  await assert.rejects(db.query('INSERT INTO pricing_settings (id) VALUES (2)'))
  await assert.rejects(db.query("INSERT INTO clemson_home_games (game_date, opponent, source_url) VALUES ('2026-12-05', 'X', 'u')"), 'kickoff or TBA required')
})

test('margin alerts accept quote, booking, compare rows', async (t) => {
  const db = await fixture(t)
  await db.query("INSERT INTO pricing_margin_alerts (source, tier, fare_cents, profit_cents, margin_bps, target_bps) VALUES ('quote', 'standard', 590, -4, -68, 1500)")
  await db.query("INSERT INTO pricing_margin_alerts (source, tier, details) VALUES ('compare', 'basket', '{\"alerts\":[]}')")
  await assert.rejects(db.query("INSERT INTO pricing_margin_alerts (source) VALUES ('other')"))
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM pricing_margin_alerts')).rows[0].n), 2)
})
