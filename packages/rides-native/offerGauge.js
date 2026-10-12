/**
 * "Worth-it" gauge for driver offer cards. Pure, no React.
 *
 * Effective $/hr = driver net payout (tips excluded unless prepaid)
 *                  / (pickup ETA minutes + trip minutes) * 60.
 *
 * Tiers (lower bound inclusive, upper exclusive; Crown is strictly above $100):
 *   < 30 orange · [30,35) green · [35,40) blue · [40,45) gold
 *   [45,50) purple "Premium" · [50,100] diamond · > 100 crown
 */

import { offerLegs } from './offerLadder.js'

export const GAUGE_TIERS = Object.freeze([
  { id: 'orange', label: 'Low', min: -Infinity },
  { id: 'green', label: 'Worth it', min: 30 },
  { id: 'blue', label: 'Good', min: 35 },
  { id: 'gold', label: 'Great', min: 40 },
  { id: 'purple', label: 'Premium', min: 45 },
  { id: 'diamond', label: 'Diamond', min: 50 },
  { id: 'crown', label: 'Crown', min: 100, exclusiveMin: true },
])

/** Gauge scale used by the arc: 0 → $0/hr, 1 → $60/hr (Diamond and Crown pin full). */
export const GAUGE_FULL_SCALE = 60

export function gaugeTier(dollarsPerHour) {
  const v = Number(dollarsPerHour)
  if (!Number.isFinite(v)) return null
  if (v > 100) return 'crown'
  if (v >= 50) return 'diamond'
  if (v >= 45) return 'purple'
  if (v >= 40) return 'gold'
  if (v >= 35) return 'blue'
  if (v >= 30) return 'green'
  return 'orange'
}

/**
 * Diamond sub-level 1..5 inside [50,100]: [50,60)=1, [60,70)=2, [70,80)=3, [80,90)=4, [90,100]=5.
 * Null outside the Diamond tier.
 */
export function diamondLevel(dollarsPerHour) {
  const v = Number(dollarsPerHour)
  if (gaugeTier(v) !== 'diamond') return null
  if (v >= 90) return 5
  if (v >= 80) return 4
  if (v >= 70) return 3
  if (v >= 60) return 2
  return 1
}

const ROMAN = ['', '', ' II', ' III', ' IV', ' V']

/**
 * Effect recipe per tier/level. The component reads only this; intensity ramps monotonically.
 * haptics: number of celebratory pulses when the offer appears.
 */
export function gaugeEffects(tier, level = null) {
  const none = { shimmerMs: 0, glow: 0, sparkles: 0, ring: false, burst: false, haptics: 0 }
  if (tier === 'crown') return { shimmerMs: 2600, glow: 1, sparkles: 8, ring: true, burst: true, haptics: 1, crown: true }
  if (tier !== 'diamond') return none
  const l = level || 1
  return {
    shimmerMs: [0, 3200, 2200, 1800, 1500, 1200][l],
    glow: [0, 0, 0.35, 0.5, 0.75, 0.95][l],
    sparkles: l >= 3 ? [0, 0, 0, 3, 5, 7][l] : 0,
    ring: l >= 4,
    burst: l >= 5,
    haptics: l >= 5 ? 2 : 0,
  }
}

export function gaugeTierLabel(tierId) {
  return GAUGE_TIERS.find((t) => t.id === tierId)?.label ?? null
}

/** Net cents the gauge counts: payout, plus tip only when it was prepaid. */
export function gaugeNetCents({ netCents, tipCents = 0, tipPrepaid = false } = {}) {
  const net = Math.max(0, Math.round(Number(netCents) || 0))
  const tip = tipPrepaid ? Math.max(0, Math.round(Number(tipCents) || 0)) : 0
  return net + tip
}

/** Dollars per hour, or null when minutes are unknown. */
export function effectiveHourly({ netCents, tipCents, tipPrepaid, pickupMinutes, tripMinutes } = {}) {
  const minutes = Math.max(0, Number(pickupMinutes) || 0) + Math.max(0, Number(tripMinutes) || 0)
  if (!(minutes > 0)) return null
  return (gaugeNetCents({ netCents, tipCents, tipPrepaid }) / 100) / (minutes / 60)
}

export function formatGauge(dollarsPerHour) {
  const v = dollarsPerHour == null ? NaN : Number(dollarsPerHour)
  if (!Number.isFinite(v)) return '—/hr'
  return `$${Math.max(0, Math.round(v))}/hr`
}

/** Fraction 0..1 for the arc fill. */
export function gaugeFill(dollarsPerHour) {
  const v = Number(dollarsPerHour)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.min(1, v / GAUGE_FULL_SCALE)
}

/** Everything the pill needs. */
export function offerGauge(input) {
  const hourly = effectiveHourly(input)
  const tier = hourly == null ? null : gaugeTier(hourly)
  return {
    effects: gaugeEffects(tier, tier === 'diamond' ? diamondLevel(hourly) : null),
    hourly,
    text: formatGauge(hourly),
    tier,
    level: tier === 'diamond' ? diamondLevel(hourly) : null,
    tierLabel: tier ? gaugeTierLabel(tier) + (tier === 'diamond' ? ROMAN[diamondLevel(hourly)] : '') : null,
    fill: gaugeFill(hourly),
    accessibilityLabel: hourly == null
      ? 'Hourly rate unavailable'
      : `Effective pay ${formatGauge(hourly)}, ${gaugeTierLabel(tier)}${tier === 'diamond' ? ROMAN[diamondLevel(hourly)] : ''}`,
  }
}

/** Light/dark palette per tier. Text colors meet 4.5:1 on their pill fill. */
export const GAUGE_PALETTE = Object.freeze({
  orange: { light: { bg: '#FFF1E6', fg: '#9A3F00', accent: '#F56600' }, dark: { bg: '#3A1E0A', fg: '#FFB57A', accent: '#FF8A2B' } },
  green: { light: { bg: '#E7F7EC', fg: '#0F6B2F', accent: '#22A04B' }, dark: { bg: '#0D2E19', fg: '#7FE0A0', accent: '#34C759' } },
  blue: { light: { bg: '#E6F0FF', fg: '#0B4FB3', accent: '#0A84FF' }, dark: { bg: '#0B2340', fg: '#8EC2FF', accent: '#409CFF' } },
  gold: { light: { bg: '#FFF6DB', fg: '#7A5600', accent: '#D4A017' }, dark: { bg: '#33280A', fg: '#FFD66B', accent: '#FFC933' } },
  purple: { light: { bg: '#F0E8FA', fg: '#4B1C8C', accent: '#522D80' }, dark: { bg: '#24123D', fg: '#D2B8FF', accent: '#9B6BE0' } },
  diamond: { light: { bg: '#EAF8FC', fg: '#0B5566', accent: '#5FD3E8', gradient: ['#FFFFFF', '#D9F6FB', '#B8ECF5'] }, dark: { bg: '#0C2A33', fg: '#C9F4FB', accent: '#7FE3F2', gradient: ['#123A45', '#0E2F38', '#1B4B57'] } },
  crown: { light: { bg: '#FFF4E5', fg: '#3B1466', accent: '#F56600', gradient: ['#F56600', '#FFC933', '#9B6BE0'] }, dark: { bg: '#2A1238', fg: '#FFFFFF', accent: '#FFC933', gradient: ['#C24E00', '#B8860B', '#5B2A99'] } },
})

/** Gauge for a driver offer card: ladder/stored net, driver->pickup ETA + routed trip. */
export function offerCardGauge(card, driver) {
  const legs = offerLegs(card, driver)
  return offerGauge({
    netCents: legs.netCents,
    // Only a tip prepaid at booking counts; post-trip tips are never in the gauge.
    tipCents: card?.prepaidTipCents || 0,
    tipPrepaid: true,
    pickupMinutes: legs.pickupSeconds / 60,
    tripMinutes: legs.tripSeconds / 60,
  })
}
