/**
 * Quote/booking-time margin check (John's 2026-10-17 profit rule).
 * Below-target fares are still allowed (no auto-refusal); they are logged to
 * public.pricing_margin_alerts for the daily summary
 * (scripts/pricing/margin-report.mjs). Quote logging is throttled per
 * (tier, fare, surge) so a rider dragging a pin cannot flood the table.
 */
import { fareMargin } from '../shared/pricingMargin.js'
import { pricingSettings } from './pricingConfig.js'

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
