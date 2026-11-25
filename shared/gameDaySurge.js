/**
 * Game-day pricing (John's 2026-10-17 surge decision).
 *
 *   - 1.25x, only on Clemson home football game days.
 *   - Window: kickoff - 4h to kickoff + 3h (America/New_York). TBA kickoff:
 *     the stored default window for that date (10:00-23:59 ET unless the row
 *     carries a narrower window derived from the published time).
 *   - Only when the pickup OR the dropoff is within ~2 miles of Memorial
 *     Stadium (34.6788, -82.8432).
 *   - Never stacks: the fare engine takes the single highest rule and caps
 *     every surge at SURGE_CAP (1.25x).
 *   - Scheduled rides are priced at the scheduled pickup time.
 *
 * The schedule lives in public.clemson_home_games (loaded by
 * server/pricingConfig.js on a short cache). Until that load succeeds, the
 * seed in shared/data/clemsonHomeFootball.js is used.
 * Pure functions except the module-level schedule/config cache.
 */
import { CLEMSON_HOME_FOOTBALL } from './data/clemsonHomeFootball.js'
import { zonedCivilToUtc } from './rideTime.js'

export const MEMORIAL_STADIUM = Object.freeze({ label: 'Memorial Stadium', lat: 34.6788, lng: -82.8432 })
export const GAME_DAY_TIME_ZONE = 'America/New_York'
export const GAME_DAY_LABEL = 'Game-day pricing'
export const GAME_DAY_EXPLAINER =
  'Clemson home game today. Fares to and from the stadium area are 1.25x from 4 hours before kickoff to 3 hours after. Your total is shown before you book.'

/** Hard ceiling on any surge. Config can lower it, never raise it. */
export const SURGE_CAP = 1.25

export const GAME_DAY_DEFAULTS = Object.freeze({
  multiplier: 1.25,
  radiusMiles: 2,
  beforeMin: 240,
  afterMin: 180,
  tbaStartMin: 10 * 60,
  tbaEndMin: 23 * 60 + 59,
  weekendMultiplier: 1,
  surgeCap: SURGE_CAP,
})

function clampNum(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/** Merge a DB/settings override onto the defaults. Multipliers can never exceed SURGE_CAP. */
export function normalizeGameDayConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = GAME_DAY_DEFAULTS
  const surgeCap = clampNum(c.surgeCap, 1, SURGE_CAP, d.surgeCap)
  return {
    multiplier: clampNum(c.multiplier, 1, surgeCap, Math.min(d.multiplier, surgeCap)),
    radiusMiles: clampNum(c.radiusMiles, 0.25, 5, d.radiusMiles),
    beforeMin: Math.round(clampNum(c.beforeMin, 0, 12 * 60, d.beforeMin)),
    afterMin: Math.round(clampNum(c.afterMin, 0, 12 * 60, d.afterMin)),
    tbaStartMin: Math.round(clampNum(c.tbaStartMin, 0, 24 * 60, d.tbaStartMin)),
    tbaEndMin: Math.round(clampNum(c.tbaEndMin, 0, 24 * 60, d.tbaEndMin)),
    weekendMultiplier: clampNum(c.weekendMultiplier, 1, surgeCap, d.weekendMultiplier),
    surgeCap,
  }
}

let activeConfig = normalizeGameDayConfig(null)
let activeGames = normalizeHomeGames(CLEMSON_HOME_FOOTBALL)
let gamesSource = 'seed'

export function gameDayConfig() {
  return activeConfig
}

export function setGameDayConfig(raw) {
  activeConfig = normalizeGameDayConfig(raw)
  return activeConfig
}

function hhmmToMin(value) {
  if (value == null || value === '') return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Accepts seed rows ({ date, opponent, kickoffEt, tba, windowStartEt, windowEndEt })
 * or DB rows ({ game_date, opponent, kickoff_et, kickoff_tba, window_start_et, window_end_et, active }).
 * Rows with a bad date are dropped.
 */
export function normalizeHomeGames(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.active === false) continue
    const date = String(row.date ?? row.game_date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const kickoffMin = hhmmToMin(row.kickoffEt ?? row.kickoff_et)
    const tba = Boolean(row.tba ?? row.kickoff_tba) || kickoffMin == null
    out.push({
      date,
      opponent: String(row.opponent ?? '').slice(0, 80) || null,
      kickoffMin: tba ? null : kickoffMin,
      tba,
      windowStartMin: hhmmToMin(row.windowStartEt ?? row.window_start_et),
      windowEndMin: hhmmToMin(row.windowEndEt ?? row.window_end_et),
    })
  }
  return out
}

export function homeGames() {
  return activeGames
}

export function homeGamesSource() {
  return gamesSource
}

/** Replace the schedule (DB load). An empty or invalid list keeps the current one. */
export function setHomeGames(rows, source = 'db') {
  const next = normalizeHomeGames(rows)
  if (!next.length) return false
  activeGames = next
  gamesSource = source
  return true
}

/** Test helper: back to the seed schedule and default config. */
export function resetGameDayState() {
  activeConfig = normalizeGameDayConfig(null)
  activeGames = normalizeHomeGames(CLEMSON_HOME_FOOTBALL)
  gamesSource = 'seed'
}

function civilMs(date, minutes) {
  const [y, m, d] = date.split('-').map(Number)
  const h = Math.floor(minutes / 60)
  const min = minutes % 60
  const at = zonedCivilToUtc(y, m, d, h, min, 0, GAME_DAY_TIME_ZONE)
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at.getTime() : null
}

/**
 * [startMs, endMs) for one home game.
 * Known kickoff: kickoff - beforeMin .. kickoff + afterMin.
 * TBA: the row's stored window, else the config TBA window for that date.
 */
export function gameWindow(game, config = activeConfig) {
  if (!game?.date) return null
  if (!game.tba && game.kickoffMin != null) {
    const kick = civilMs(game.date, game.kickoffMin)
    if (kick == null) return null
    return { startMs: kick - config.beforeMin * 60000, endMs: kick + config.afterMin * 60000, tba: false }
  }
  const startMin = game.windowStartMin ?? config.tbaStartMin
  const endMin = game.windowEndMin ?? config.tbaEndMin
  const startMs = civilMs(game.date, startMin)
  const endMs = civilMs(game.date, endMin)
  if (startMs == null || endMs == null || endMs <= startMs) return null
  return { startMs, endMs, tba: true }
}

/** The home game whose pricing window contains `at`, else null. */
export function activeHomeGame(at = new Date(), { games = activeGames, config = activeConfig } = {}) {
  const when = at instanceof Date ? at : new Date(at)
  const t = when.getTime()
  if (!Number.isFinite(t)) return null
  for (const game of games) {
    const w = gameWindow(game, config)
    if (w && t >= w.startMs && t < w.endMs) return { ...game, window: w }
  }
  return null
}

const EARTH_MILES = 3958.7613

export function milesBetween(a, b) {
  const la1 = Number(a?.lat)
  const ln1 = Number(a?.lng)
  const la2 = Number(b?.lat)
  const ln2 = Number(b?.lng)
  if (![la1, ln1, la2, ln2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (la2 - la1) * rad
  const dLng = (ln2 - ln1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function nearStadium(place, radiusMiles = activeConfig.radiusMiles) {
  const d = milesBetween(place, MEMORIAL_STADIUM)
  return d != null && d <= radiusMiles
}

/**
 * Does game-day pricing apply to this trip at `at`?
 * eventActive: a live public.game_day_events row (admin-created special event)
 * also opens the window; the stadium radius still applies.
 */
export function gameDaySurge({ at = new Date(), pickup = null, dropoff = null, eventActive = false, games, config } = {}) {
  const cfg = config || activeConfig
  const game = activeHomeGame(at, { games: games || activeGames, config: cfg })
  const windowOpen = Boolean(game) || Boolean(eventActive)
  if (!windowOpen) return { applies: false, multiplier: 1, game: null, reason: 'no_game_window' }
  const near = nearStadium(pickup, cfg.radiusMiles) || nearStadium(dropoff, cfg.radiusMiles)
  if (!near) return { applies: false, multiplier: 1, game, reason: 'outside_radius' }
  return { applies: true, multiplier: cfg.multiplier, game, reason: game ? 'home_game' : 'game_day_event' }
}
