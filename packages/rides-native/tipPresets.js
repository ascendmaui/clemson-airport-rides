/**
 * Post-ride tip choices. The main buttons are 15%, 20%, and 25% of the fare.
 * A custom dollar amount is separate. Dollar presets are not offered.
 */

export const TIP_PERCENTS = [15, 20, 25]
export const MIN_TIP_CENTS = 100
export const MAX_TIP_CENTS = 10000

export const FARE_UNKNOWN_TIP_NOTE = 'Fare is not on this ride yet, so percent tips stay off until it is.'

export function formatTipCents(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

/** @returns {number | null} null when the trip has no fare to take a percent of */
export function knownFareCents(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

export function isTipPercent(percent) {
  return TIP_PERCENTS.includes(Number(percent))
}

/** Whole cents. Null when the fare or percent cannot be priced. */
export function tipCentsForPercent(fareCents, percent) {
  const fare = knownFareCents(fareCents)
  const pct = Number(percent)
  if (fare == null || !isTipPercent(pct)) return null
  return Math.round((fare * pct) / 100)
}

export function presetChargeable(cents) {
  return cents != null && cents >= MIN_TIP_CENTS && cents <= MAX_TIP_CENTS
}

export function tipPresetView(fareCents) {
  const fare = knownFareCents(fareCents)
  return TIP_PERCENTS.map((percent) => {
    if (fare == null) {
      return {
        percent,
        cents: null,
        chargeable: false,
        label: `${percent}%`,
        detail: null,
        accessibilityLabel: `${percent} percent. Fare is not on this ride yet.`,
      }
    }
    const cents = tipCentsForPercent(fare, percent)
    const chargeable = presetChargeable(cents)
    const detail = formatTipCents(cents)
    return {
      percent,
      cents,
      chargeable,
      label: `${percent}%`,
      detail,
      accessibilityLabel: chargeable
        ? `Tip ${percent} percent, ${detail}`
        : `${percent} percent is ${detail}, outside the $1 to $100 tip range`,
    }
  })
}

/**
 * Custom amount from a dollar field. "8" and "8.50" are dollars, not cents.
 * @returns {{ cents: number } | { error: string }}
 */
export function customTipCents(raw) {
  const text = String(raw ?? '').trim().replace(/^\$/, '')
  if (!text) return { error: 'Enter a tip amount' }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter a dollar amount' }
  const cents = Math.round(Number(text) * 100)
  if (!Number.isFinite(cents) || cents < MIN_TIP_CENTS || cents > MAX_TIP_CENTS) {
    return { error: 'Tip must be between $1 and $100' }
  }
  return { cents }
}

/** Body for POST /api/trip-tip. Percent wins so a dollar field cannot replace it. */
export function tipChargeBody({ tripId, percent = null, customCents = null }) {
  const body = { tripId, mode: 'charge' }
  if (isTipPercent(percent)) {
    body.tipPercent = Number(percent)
    return body
  }
  body.tipCents = customCents
  return body
}
