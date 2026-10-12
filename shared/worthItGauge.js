/**
 * Worth-it gauge tiers for a driver offer, per hour.
 * Labels, ranges, notes, and colors match the Drive page legend.
 */

export const WORTH_IT_LEGEND_TITLE = 'Worth-it gauge tiers (per hour)'
export const WORTH_IT_LEGEND_LABEL = 'Worth-it gauge tiers, per-hour pay'
export const WORTH_IT_GAUGE_BODY = 'Each offer lights up by its hourly rate, from orange through Diamond and Crown. See the tier legend below.'

export const PAY_TIERS = Object.freeze([
  Object.freeze({ id: 'orange', label: 'Orange', range: 'Under $30', note: 'Base', color: '#F56600' }),
  Object.freeze({ id: 'green', label: 'Green', range: '$30\u201335', note: 'Solid', color: '#22C55E' }),
  Object.freeze({ id: 'blue', label: 'Blue', range: '$35\u201340', note: 'Strong', color: '#3B82F6' }),
  Object.freeze({ id: 'gold', label: 'Gold', range: '$40\u201345', note: 'Great', color: '#EAB308' }),
  Object.freeze({ id: 'purple', label: 'Purple', range: '$45\u201350', note: 'Excellent', color: '#522D80' }),
  Object.freeze({ id: 'diamond', label: 'Diamond', range: '$50\u2013100', note: 'Escalating effects', color: '#7DD3FC' }),
  Object.freeze({ id: 'crown', label: 'Crown', range: 'Above $100', note: 'Top tier', color: '#FBBF24' }),
])

/**
 * Shared range edges belong to the higher tier.
 * $100.00 is still Diamond. Above $100 is Crown.
 * @param {number | null | undefined} cents
 */
export function worthItTierForHourlyCents(cents) {
  if (cents == null || cents === '') return null
  const n = Number(cents)
  if (!Number.isFinite(n)) return null
  const dollars = Math.max(0, n) / 100
  if (dollars < 30) return PAY_TIERS[0]
  if (dollars < 35) return PAY_TIERS[1]
  if (dollars < 40) return PAY_TIERS[2]
  if (dollars < 45) return PAY_TIERS[3]
  if (dollars < 50) return PAY_TIERS[4]
  if (dollars <= 100) return PAY_TIERS[5]
  return PAY_TIERS[6]
}
