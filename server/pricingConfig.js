/**
 * DB-backed pricing config with a short in-process cache.
 *
 *   public.pricing_rate_cards  per-tier rate inputs (standard seeded; comfort/wait optional)
 *   public.pricing_settings    margin target, Stripe fee, overhead, floors, game-day knobs
 *   public.clemson_home_games  home-game schedule for game-day pricing
 *
 * refreshPricingConfig(sb) is awaited by loadGameDayMultiplier (server/creditLots.js),
 * which every server pricing path already calls before it prices, so quote,
 * checkout, request, schedule, and settle all see the same config.
 * Any read error keeps the last good config (or the in-code seed). Fail safe:
 * a bad row can never zero a fare (src/lib/fareRates.js validFareCard bounds).
 */
import { setFareCards, activeFareCards } from '../src/lib/fareRates.js'
import { setGameDayConfig, setHomeGames, gameDayConfig, homeGamesSource } from '../shared/gameDaySurge.js'
import { MARGIN_DEFAULTS, normalizeMarginSettings } from '../shared/pricingMargin.js'
import { COMPARE_DEFAULTS } from '../shared/pricingCompare.js'

export const PRICING_CONFIG_TTL_MS = 60_000

const state = {
  loadedAt: 0,
  inflight: null,
  settings: defaultSettings(),
  source: 'seed',
}

export function defaultSettings() {
  return {
    margin: normalizeMarginSettings(null),
    floors: {
      perMileCents: COMPARE_DEFAULTS.floorPerMileCents,
      perMinuteCents: COMPARE_DEFAULTS.floorPerMinuteCents,
      minFareCents: COMPARE_DEFAULTS.floorMinFareCents,
    },
    undercutBps: COMPARE_DEFAULTS.undercutBps,
  }
}

function num(v) {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Map one pricing_settings row onto margin/floors/game-day config. */
export function settingsFromRow(row) {
  const base = defaultSettings()
  if (!row || typeof row !== 'object') return { settings: base, gameDay: null }
  const pct = (v) => (num(v) == null ? undefined : Math.round(num(v) * 100))
  const settings = {
    margin: normalizeMarginSettings({
      targetMarginBps: pct(row.target_margin_pct),
      stripeFeeBps: pct(row.stripe_fee_pct),
      stripeFixedCents: num(row.stripe_fixed_cents),
      overheadCents: num(row.overhead_cents_per_ride),
      carpoolOverheadSeats: num(row.carpool_overhead_seats),
      driverShareBps: MARGIN_DEFAULTS.driverShareBps,
    }),
    floors: {
      perMileCents: num(row.floor_per_mile_cents) ?? base.floors.perMileCents,
      perMinuteCents: num(row.floor_per_minute_cents) ?? base.floors.perMinuteCents,
      minFareCents: num(row.floor_min_fare_cents) ?? base.floors.minFareCents,
    },
    undercutBps: pct(row.competitor_undercut_pct) ?? base.undercutBps,
  }
  const gameDay = {
    multiplier: num(row.game_day_multiplier),
    radiusMiles: num(row.game_day_radius_miles),
    beforeMin: num(row.game_day_before_min),
    afterMin: num(row.game_day_after_min),
    weekendMultiplier: num(row.weekend_multiplier),
    surgeCap: num(row.surge_cap),
  }
  return { settings, gameDay }
}

async function select(sb, table, columns, apply) {
  let q = sb.from(table).select(columns)
  if (apply) q = apply(q)
  const res = await q
  if (!res || res.error || !Array.isArray(res.data)) return null
  return res.data
}

async function load(sb, now) {
  const [cards, settingsRows, games] = await Promise.all([
    select(sb, 'pricing_rate_cards', 'tier, base_cents, booking_fee_cents, per_mile_cents, per_minute_cents, min_fare_cents, active', (q) => q.eq('active', true)).catch(() => null),
    select(sb, 'pricing_settings', '*', (q) => q.eq('id', 1)).catch(() => null),
    select(sb, 'clemson_home_games', 'game_date, opponent, kickoff_et, kickoff_tba, window_start_et, window_end_et, active', (q) => q.eq('active', true)).catch(() => null),
  ])
  let any = false
  if (cards) {
    const byTier = {}
    for (const row of cards) {
      if (row && typeof row.tier === 'string' && row.active !== false) byTier[row.tier] = row
    }
    if (byTier.standard) {
      setFareCards(byTier)
      any = true
    }
  }
  if (settingsRows && settingsRows[0] && typeof settingsRows[0] === 'object' && 'target_margin_pct' in settingsRows[0]) {
    const { settings, gameDay } = settingsFromRow(settingsRows[0])
    state.settings = settings
    setGameDayConfig(gameDay)
    any = true
  }
  if (games && games.length && games.every((g) => g && 'game_date' in g)) {
    if (setHomeGames(games, 'db')) any = true
  }
  state.loadedAt = now
  if (any) state.source = 'db'
  return state
}

/** Refresh at most once per TTL; concurrent callers share one load. Never throws. */
export async function refreshPricingConfig(sb, { now = Date.now(), force = false } = {}) {
  if (!sb || typeof sb.from !== 'function') return state
  if (!force && state.loadedAt && now - state.loadedAt < PRICING_CONFIG_TTL_MS) return state
  if (state.inflight) return state.inflight
  state.inflight = load(sb, now)
    .catch(() => {
      state.loadedAt = now
      return state
    })
    .finally(() => {
      state.inflight = null
    })
  return state.inflight
}

export function pricingSettings() {
  return state.settings
}

export function pricingConfigSnapshot() {
  return {
    source: state.source,
    loadedAt: state.loadedAt ? new Date(state.loadedAt).toISOString() : null,
    cards: activeFareCards(),
    settings: state.settings,
    gameDay: gameDayConfig(),
    homeGamesSource: homeGamesSource(),
  }
}

/** Test helper. */
export function resetPricingConfigCache() {
  state.loadedAt = 0
  state.inflight = null
  state.settings = defaultSettings()
  state.source = 'seed'
}
