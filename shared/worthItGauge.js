/**
 * Worth-it gauge tiers for a driver offer, per hour.
 * Names, ranges, and swatches match the offer gauge (packages/rides-native/offerGauge.js).
 * Shared range edges belong to the higher tier. $100 stays Diamond. Above $100 is Crown.
 */

import { GAUGE_PALETTE, GAUGE_TIERS } from '../packages/rides-native/offerGauge.js'

export const WORTH_IT_LEGEND_TITLE = 'Worth-it gauge tiers (per hour)'
export const WORTH_IT_LEGEND_LABEL = 'Worth-it gauge tiers, per-hour pay'
export const WORTH_IT_GAUGE_BODY = 'Each offer lights up by its hourly rate, from orange through Diamond and Crown. See the tier legend below.'

const RANGE_BY_ID = Object.freeze({
  orange: 'Under $30',
  green: '$30\u201335',
  blue: '$35\u201340',
  gold: '$40\u201345',
  purple: '$45\u201350',
  diamond: '$50\u2013100',
  crown: 'Above $100',
})

const NOTE_BY_ID = Object.freeze({
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  gold: 'Gold',
  purple: 'Purple',
  diamond: 'Escalating effects',
  crown: 'Top tier',
})

export const PAY_TIERS = Object.freeze(GAUGE_TIERS.map((tier) => Object.freeze({
  id: tier.id,
  label: tier.label,
  range: RANGE_BY_ID[tier.id],
  note: NOTE_BY_ID[tier.id],
  color: tier.id === 'crown' ? GAUGE_PALETTE.crown.light.gradient[1] : GAUGE_PALETTE[tier.id].light.accent,
})))

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
