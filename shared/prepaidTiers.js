/**
 * Prepaid credit packs. These are wallet top-ups, not airport/Uber rate cards.
 * Ride pricing stays in src/lib/pricing.js and server/friendRideLib.js.
 */

export const PREPAID_TIERS = [
  { id: 'credits_25', priceCents: 2500, creditCents: 2500, label: '$25 credits' },
  { id: 'credits_50', priceCents: 5000, creditCents: 5200, label: '$50 credits · $2 bonus' },
  { id: 'credits_100', priceCents: 10000, creditCents: 11000, label: '$100 credits · $10 bonus' },
]

export function findPrepaidTier(tierId) {
  return PREPAID_TIERS.find((tier) => tier.id === tierId) || null
}

/** Stable USD from cents. Matches the rider app's formatCents for whole-dollar packs. */
export function formatUsdCents(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

/**
 * Confirmation copy for a prepaid pack.
 * Credit and bonus come from the tier. Total charged is priceCents — the amount
 * the existing buy path sends to Stripe. Nothing here changes that charge.
 */
export function prepaidPurchaseSummary(tier) {
  if (!tier) return null
  const chargedCents = Math.round(Number(tier.priceCents) || 0)
  const grantedCents = Math.round(Number(tier.creditCents) || 0)
  const bonusCents = Math.max(0, grantedCents - chargedCents)
  const creditCents = Math.max(0, grantedCents - bonusCents)
  const credit = formatUsdCents(creditCents)
  const bonus = formatUsdCents(bonusCents)
  const charged = formatUsdCents(chargedCents)
  const granted = formatUsdCents(grantedCents)
  return {
    creditCents,
    bonusCents,
    chargedCents,
    grantedCents,
    credit,
    bonus,
    charged,
    granted,
    title: 'Confirm credit purchase',
    body: `Add ${credit} in credits plus a ${bonus} bonus (${granted} in credits). Total charged: ${charged}.`,
    confirmLabel: `Charge ${charged}`,
    cancelLabel: 'Cancel',
  }
}

/** Ledger payload from GET action=credits. Unavailable is not shown as $0. */
export function prepaidCreditsFromPayload(data) {
  const tiers = Array.isArray(data?.tiers) ? data.tiers : []
  if (!data || data.unavailable) {
    return { balanceCents: null, unavailable: true, tiers }
  }
  const balance = Number(data.balanceCents)
  if (!Number.isFinite(balance)) {
    return { balanceCents: null, unavailable: true, tiers }
  }
  return { balanceCents: Math.round(balance), unavailable: false, tiers }
}
