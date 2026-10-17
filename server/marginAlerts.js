/**
 * Quote/booking-time margin check (John's 2026-10-17 profit rule).
 * Below-target fares are still allowed (no auto-refusal); they are logged to
 * public.pricing_margin_alerts for the daily summary
 * (scripts/pricing/margin-report.mjs). Quote logging is throttled per
 * (tier, fare, surge) so a rider dragging a pin cannot flood the table.
 */
import { fareMargin } from '../shared/pricingMargin.js'
import { pricingSettings } from './pricingConfig.js'
import { zonedCivilToUtc } from '../shared/rideTime.js'

const QUOTE_DEDUP_MS = 10 * 60 * 1000
const QUOTE_MAX_PER_HOUR = 200
const recent = new Map()
let hourStart = 0
let hourCount = 0

/** Margin of a priced quote. Carpool is checked per seat (each seat is its own charge). */
export function marginForPriced(priced, { tier = null, settings = null, driverPayout = null } = {}) {
  const b = priced?.breakdown || priced?.quote?.breakdown || {}
  const id = String(tier || priced?.tier || 'standard')
  const carpool = id === 'carpool'
  const seats = Math.max(1, Math.round(Number(priced?.seatCount ?? b.seat_count) || 1))
  const total = Math.max(0, Math.round(Number(priced?.fareCents) || 0))
  const perCharge = carpool ? Math.max(0, Math.round(Number(priced?.perSeatFareCents ?? b.per_seat_fare_cents ?? total / seats) || 0)) : total
  // Booking: the actual offer-ladder payout on the whole charge. Quote: the 80% exclusive share (highest).
  const margin = driverPayout != null
    ? fareMargin({ fareCents: total, driverPayout, carpool, settings: settings || pricingSettings().margin })
    : fareMargin({ fareCents: perCharge, carpool, settings: settings || pricingSettings().margin })
  return { ...margin, tier: id, seatCount: carpool ? seats : 1, surgeMultiplier: Number(priced?.surge?.multiplier) || 1 }
}

function throttled(key, now) {
  if (now - hourStart > 3600_000) {
    hourStart = now
    hourCount = 0
  }
  if (hourCount >= QUOTE_MAX_PER_HOUR) return true
  const last = recent.get(key)
  if (last && now - last < QUOTE_DEDUP_MS) return true
  recent.set(key, now)
  hourCount += 1
  if (recent.size > 2000) {
    for (const [k, t] of recent) if (now - t > QUOTE_DEDUP_MS) recent.delete(k)
  }
  return false
}

/**
 * Insert one alert row when the margin is under target. Never throws, never
 * blocks the ride. Returns the row it tried to write, or null.
 */
export async function logMarginAlert(sb, { source = 'quote', tripId = null, margin, details = {}, now = Date.now() } = {}) {
  if (!margin || !margin.belowTarget) return null
  if (!sb || typeof sb.from !== 'function') return null
  if (source === 'quote' && throttled(`${margin.tier}|${margin.fareCents}|${margin.surgeMultiplier}`, now)) return null
  const row = {
    source,
    trip_id: tripId,
    tier: margin.tier,
    fare_cents: margin.fareCents,
    driver_payout_cents: margin.driverPayoutCents,
    stripe_fee_cents: margin.stripeFeeCents,
    overhead_cents: margin.overheadCents,
    profit_cents: margin.profitCents,
    margin_bps: margin.marginBps,
    target_bps: margin.targetBps,
    surge_multiplier: margin.surgeMultiplier,
    seat_count: margin.seatCount,
    details,
  }
  try {
    const res = await sb.from('pricing_margin_alerts').insert(row)
    if (res?.error) return null
  } catch {
    return null
  }
  return row
}

export function resetMarginAlertThrottle() {
  recent.clear()
  hourStart = 0
  hourCount = 0
}

/** [start, end) of the ET calendar day before `now` (handles DST). */
export function yesterdayEtRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [y, m, d] = parts.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  const start = zonedCivilToUtc(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 0, 0, 0, 'America/New_York')
  const end = zonedCivilToUtc(y, m, d, 0, 0, 0, 'America/New_York')
  const label = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(start)
  return { start, end, label }
}

/**
 * Daily summary of below-margin rows. Bookings are real rides (trip_id set);
 * quotes are rider looks that may not have booked. Compare rows are blocked
 * --apply runs of the competitor script.
 */
export function summarizeMarginAlerts(rows = []) {
  const by = { booking: [], quote: [], compare: [] }
  for (const r of rows) if (by[r.source]) by[r.source].push(r)
  const tiers = {}
  let lossCents = 0
  let shortfallCents = 0
  for (const r of by.booking) {
    const t = (tiers[r.tier || 'unknown'] ||= { rides: 0, fareCents: 0, profitCents: 0, unprofitable: 0, worstMarginBps: null })
    t.rides += 1
    t.fareCents += r.fare_cents || 0
    t.profitCents += r.profit_cents || 0
    if ((r.profit_cents || 0) < 0) {
      t.unprofitable += 1
      lossCents += -(r.profit_cents || 0)
    }
    t.worstMarginBps = t.worstMarginBps == null ? r.margin_bps : Math.min(t.worstMarginBps, r.margin_bps)
    // Profit missing versus the target on this ride.
    const targetProfit = Math.floor(((r.fare_cents || 0) * (r.target_bps || 0)) / 10000)
    shortfallCents += Math.max(0, targetProfit - (r.profit_cents || 0))
  }
  return {
    belowTargetRides: by.booking.length,
    unprofitableRides: by.booking.filter((r) => (r.profit_cents || 0) < 0).length,
    lossCents,
    shortfallVsTargetCents: shortfallCents,
    belowTargetQuotes: by.quote.length,
    blockedApplyRuns: by.compare.length,
    tiers,
    worst: [...by.booking].sort((a, b) => a.margin_bps - b.margin_bps).slice(0, 10).map((r) => ({ tripId: r.trip_id, tier: r.tier, fareCents: r.fare_cents, profitCents: r.profit_cents, marginBps: r.margin_bps, surge: Number(r.surge_multiplier) || 1 })),
  }
}
