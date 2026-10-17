/**
 * Competitor check math (pure). Used by scripts/pricing/compare-competitors.mjs
 * and its tests. John's 2026-10-17 rules:
 *   1. Every tier must be cheaper than its nearest UberX/Lyft tier on a basket
 *      of real Clemson trips; --apply targets >= undercutBps (3%) under the
 *      cheaper competitor.
 *   2. Never write rates under the driver-pay floors.
 *   3. Never write rates where any basket trip (standard, wait, comfort,
 *      carpool per seat, and the game-day 1.25x version) is under the target
 *      margin.
 * If a rule blocks the change, nothing is written and alerts explain why.
 */
import { fareMargin, normalizeMarginSettings } from './pricingMargin.js'

/**
 * Basket of real Clemson trips. Minutes are drive-time assumptions (Clemson
 * GSP 45 mi / 57 min is Uber's own Clemson city page figure).
 */
export const CLEMSON_BASKET = Object.freeze([
  { id: 'short_hop', label: 'Short campus hop (0.8 mi)', miles: 0.8, minutes: 4 },
  { id: 'campus_downtown', label: 'Campus to downtown Clemson (1.5 mi)', miles: 1.5, minutes: 6 },
  { id: 'campus_walmart', label: 'Campus to Clemson Walmart / CAT (3 mi)', miles: 3, minutes: 9 },
  { id: 'clemson_greenville', label: 'Clemson to downtown Greenville (30 mi)', miles: 30, minutes: 40 },
  { id: 'clemson_gsp', label: 'Clemson to GSP airport (45 mi)', miles: 45, minutes: 57 },
].map((t) => Object.freeze(t)))

/** Tier scales relative to Standard (src/lib/fareRates.js). */
export const TIER_SCALE_BPS = Object.freeze({ standard: 10000, wait: 8200, comfort: 14000, carpool: 5000 })

/** Which competitor tier each of our tiers is compared to. */
export const COMPETITOR_TIER_FOR = Object.freeze({
  standard: 'standard',
  wait: 'standard',
  carpool: 'standard',
  comfort: 'comfort',
})

export const COMPARE_DEFAULTS = Object.freeze({
  undercutBps: 300,
  floorPerMileCents: 90,
  floorPerMinuteCents: 18,
  floorMinFareCents: 500,
  gameDayMultiplier: 1.25,
})

const KEYS = ['baseCents', 'bookingFeeCents', 'perMileCents', 'perMinuteCents', 'minFareCents']

export function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pick = (a, b) => Math.round(Number(raw[a] ?? raw[b]))
  const card = {
    baseCents: pick('baseCents', 'base_cents'),
    bookingFeeCents: pick('bookingFeeCents', 'booking_fee_cents'),
    perMileCents: pick('perMileCents', 'per_mile_cents'),
    perMinuteCents: pick('perMinuteCents', 'per_minute_cents'),
    minFareCents: pick('minFareCents', 'min_fare_cents'),
  }
  return KEYS.every((k) => Number.isFinite(card[k]) && card[k] >= 0) ? card : null
}

/** Mirrors quoteFare: metered = base + booking + round(mi*rate) + round(min*rate); max with minimum. */
export function meteredCents(card, trip) {
  const metered = card.baseCents + card.bookingFeeCents
    + Math.round(trip.miles * card.perMileCents) + Math.round(trip.minutes * card.perMinuteCents)
  return Math.max(card.minFareCents, metered)
}

/**
 * Our fare for a tier (pre-discount, as quoted). Carpool is per seat and is
 * always 50% of Standard. Comfort/Wait use their own card when one exists,
 * else Standard x tier scale. surge is applied after the tier scale.
 */
export function ourFareCents({ cards, tier, trip, surge = 1 }) {
  const own = tier !== 'carpool' && tier !== 'standard' ? cards[tier] : null
  const card = own || cards.standard
  const scale = own ? 10000 : TIER_SCALE_BPS[tier] ?? 10000
  const classed = Math.round((meteredCents(card, trip) * scale) / 10000)
  return Math.round(classed * surge)
}

/** Competitor fare. Lyft adds its service fee on top of the minimum; Uber's minimum is all-in. */
export function competitorFareCents(comp, trip) {
  const ride = comp.baseCents + Math.round(trip.miles * comp.perMileCents) + Math.round(trip.minutes * comp.perMinuteCents)
  if (comp.minIncludesBooking) return Math.max(comp.minFareCents, ride + comp.bookingFeeCents)
  return Math.max(comp.minFareCents, ride) + comp.bookingFeeCents
}

function compsFor(tier, competitors) {
  const group = COMPETITOR_TIER_FOR[tier] || 'standard'
  return competitors.filter((c) => (c.ourTier || 'standard') === group)
}

/** One row per (tier, trip): our fare, each competitor, % difference vs the cheaper one, margins. */
export function compareBasket({ cards, competitors, basket = CLEMSON_BASKET, tiers = ['standard', 'wait', 'comfort', 'carpool'], settings = {} }) {
  const cfg = { ...COMPARE_DEFAULTS, ...settings }
  const margin = normalizeMarginSettings(settings.margin)
  const rows = []
  for (const tier of tiers) {
    const comps = compsFor(tier, competitors)
    for (const trip of basket) {
      const ours = ourFareCents({ cards, tier, trip })
      const ourGameDay = ourFareCents({ cards, tier, trip, surge: cfg.gameDayMultiplier })
      const theirs = comps.map((c) => ({ competitor: c.competitor, tier: c.tier, fareCents: competitorFareCents(c, trip) }))
      const cheapest = theirs.length ? theirs.reduce((a, b) => (b.fareCents < a.fareCents ? b : a)) : null
      const diffBps = cheapest ? Math.round(((ours - cheapest.fareCents) * 10000) / cheapest.fareCents) : null
      const targetCents = cheapest ? Math.floor((cheapest.fareCents * (10000 - cfg.undercutBps)) / 10000) : null
      rows.push({
        tier,
        trip: trip.id,
        label: trip.label,
        ourCents: ours,
        ourGameDayCents: ourGameDay,
        competitors: theirs,
        cheapest,
        diffBps,
        cheaper: cheapest ? ours < cheapest.fareCents : null,
        meetsUndercut: cheapest ? ours <= targetCents : null,
        targetCents,
        margin: fareMargin({ fareCents: ours, carpool: tier === 'carpool', settings: margin }),
        gameDayMargin: fareMargin({ fareCents: ourGameDay, carpool: tier === 'carpool', settings: margin }),
      })
    }
  }
  return rows
}

function scaleCard(card, factor) {
  const out = {}
  for (const k of KEYS) out[k] = Math.floor(card[k] * factor)
  return out
}

/** Standard x scale expressed as a card (used to seed a Comfort row from today's 1.40x). */
export function derivedCard(card, scaleBps) {
  return scaleCard(card, scaleBps / 10000)
}

function applyFloors(candidate, current, cfg) {
  const floors = { perMileCents: cfg.floorPerMileCents, perMinuteCents: cfg.floorPerMinuteCents, minFareCents: cfg.floorMinFareCents }
  const out = { ...candidate }
  const hit = []
  for (const [k, floor] of Object.entries(floors)) {
    if (out[k] < floor) {
      // Never raise a rate above where it is today ("--apply only lowers").
      out[k] = Math.min(current[k], floor)
      hit.push(k)
    }
  }
  return { card: out, floorsHit: hit }
}

function undercutViolations(cards, tiers, competitors, basket, cfg) {
  return compareBasket({ cards, competitors, basket, tiers, settings: cfg }).filter((r) => r.cheapest && !r.meetsUndercut)
}

/**
 * Plan the lowest-touch rate change that puts every basket trip >= undercutBps
 * under the cheaper competitor, inside floors and margin.
 *   group 'standard' moves the Standard card (Standard, Wait & Save, Carpool follow it).
 *   group 'comfort' moves a Comfort card (seeded from Standard x 1.40 if none).
 * Returns { ok, changes, alerts, before, after }. ok=false means: write nothing.
 */
export function planCompetitorApply({ cards, competitors, basket = CLEMSON_BASKET, settings = {} }) {
  const cfg = { ...COMPARE_DEFAULTS, ...settings }
  const groups = [
    { key: 'standard', tiers: ['standard', 'wait', 'carpool'] },
    { key: 'comfort', tiers: ['comfort'] },
  ]
  const next = { ...cards }
  const changes = []
  const alerts = []
  for (const group of groups) {
    const current = group.key === 'standard'
      ? cards.standard
      : cards.comfort || derivedCard(cards.standard, TIER_SCALE_BPS.comfort)
    if (!compsFor(group.tiers[0], competitors).length) continue
    if (!undercutViolations(next, group.tiers, competitors, basket, cfg).length) continue
    // Smallest factor any trip needs, then step down until rounding also clears.
    const rows = compareBasket({ cards: next, competitors, basket, tiers: group.tiers, settings: cfg })
    let factor = Math.min(...rows.filter((r) => r.cheapest).map((r) => r.targetCents / r.ourCents))
    let candidate = null
    let floorsHit = []
    let blocked = null
    for (let i = 0; i < 200; i += 1) {
      const floored = applyFloors(scaleCard(current, factor), current, cfg)
      candidate = floored.card
      floorsHit = floored.floorsHit
      const trial = { ...next, [group.key]: candidate }
      const left = undercutViolations(trial, group.tiers, competitors, basket, cfg)
      if (!left.length) { blocked = null; break }
      blocked = left
      if (floorsHit.length && left.length) break
      factor -= 0.001
      if (factor <= 0) break
    }
    if (blocked) {
      alerts.push({
        kind: 'floor_blocks_undercut',
        group: group.key,
        floorsHit,
        message: `Driver-pay floors stop ${group.key} from reaching ${cfg.undercutBps / 100}% under the cheaper competitor.`,
        trips: blocked.map((r) => ({ tier: r.tier, trip: r.trip, ourCents: r.ourCents, cheapestCents: r.cheapest.fareCents, cheapest: r.cheapest.tier, targetCents: r.targetCents })),
      })
      continue
    }
    next[group.key] = candidate
    changes.push({ tier: group.key, before: current, after: candidate, factor: Math.round(factor * 10000) / 10000, floorsHit })
  }
  // Margin gate on the final cards: every tier, every trip, regular and game-day.
  const finalRows = compareBasket({ cards: next, competitors, basket, settings: cfg })
  const marginTarget = normalizeMarginSettings(cfg.margin).targetMarginBps
  const underMargin = finalRows.filter((r) => r.margin.belowTarget || r.gameDayMargin.belowTarget)
  if (changes.length && underMargin.length) {
    alerts.push({
      kind: 'margin_blocks_undercut',
      message: `Staying ${cfg.undercutBps / 100}% under competitors would put ${underMargin.length} basket fares under the ${marginTarget / 100}% target margin.`,
      trips: underMargin.map((r) => ({ tier: r.tier, trip: r.trip, fareCents: r.ourCents, marginBps: r.margin.marginBps, gameDayMarginBps: r.gameDayMargin.marginBps, profitCents: r.margin.profitCents })),
    })
  }
  const ok = changes.length > 0 && alerts.length === 0
  return { ok, needed: changes.length > 0 || alerts.some((a) => a.kind === 'floor_blocks_undercut'), changes: ok ? changes : [], proposed: changes, alerts, before: cards, after: ok ? next : cards, rows: finalRows }
}
