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
