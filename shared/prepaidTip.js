/**
 * Tip boost at booking ("prepaid tip").
 * The rider picks it before the ride is requested. It is held with the fare,
 * captured with the fare at completion, released with the hold on cancel,
 * and paid 100% to the driver (no platform split). A post-trip tip
 * (trips.tip_cents) can still be added on top; that path is unchanged.
 */

export const PREPAID_TIP_PRESETS_CENTS = Object.freeze([200, 500, 1000])
/** Cap for one ride. Mirrors the trips_prepaid_tip_cents_range DB check. */
export const PREPAID_TIP_MAX_CENTS = 10000
/** Driver share in basis points. 10000 = 100%. */
export const PREPAID_TIP_DRIVER_SHARE_BPS = 10000

export function clampPrepaidTipCents(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(PREPAID_TIP_MAX_CENTS, n)
}

/** Validate a rider-chosen tip in cents. Rejects (does not clamp) bad input. */
export function parsePrepaidTipCents(raw) {
  if (raw == null || raw === '') return { ok: true, cents: 0 }
  const n = Number(typeof raw === 'string' ? raw.trim() : raw)
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a tip amount.' }
  const cents = Math.round(n)
  if (Math.abs(n - cents) > 1e-6) return { ok: false, error: 'Enter a whole-cent amount.' }
  if (cents < 0) return { ok: false, error: 'Tip cannot be negative.' }
  if (cents > PREPAID_TIP_MAX_CENTS) return { ok: false, error: `Tip cannot be more than $${PREPAID_TIP_MAX_CENTS / 100}.` }
  return { ok: true, cents }
}

/** "$7" / "7.50" → cents, same rules. */
export function parsePrepaidTipDollars(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, cents: 0 }
  const n = Number(String(raw).trim().replace(/^\$/, ''))
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a tip amount.' }
  return parsePrepaidTipCents(Math.round(n * 100))
}

/** Column first, then metadata (written alongside so older readers still see it). */
export function readPrepaidTipCents(trip) {
  if (!trip || typeof trip !== 'object') return 0
  for (const v of [trip.prepaid_tip_cents, trip.prepaidTipCents, trip.metadata?.prepaid_tip_cents]) {
    if (v != null && v !== '') return clampPrepaidTipCents(v)
  }
  return 0
}

export function driverPrepaidTipShareCents(tipCents) {
  const tip = clampPrepaidTipCents(tipCents)
  return Math.round((tip * PREPAID_TIP_DRIVER_SHARE_BPS) / 10000)
}

export function formatTipDollars(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0)) / 100
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

/** Driver offer line, e.g. "$18.40 incl. $5 tip boost". */
export function tipBoostOfferLine(totalCents, tipCents) {
  const tip = clampPrepaidTipCents(tipCents)
  if (!tip) return null
  const total = Math.max(0, Math.round(Number(totalCents) || 0))
  return `$${(total / 100).toFixed(2)} incl. ${formatTipDollars(tip)} tip boost`
}
