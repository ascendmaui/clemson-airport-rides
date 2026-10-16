/**
 * In-car tablet ad packages for /advertise.
 *
 * This is the ONE file to edit when John approves real tiers:
 *   1. Replace AD_PACKAGES with the approved tiers (keep the same fields).
 *   2. Remove `placeholder: true` from each approved tier.
 *   3. Flip ADS_PACKAGES_APPROVED to true.
 * Until then the page shows "Packages and pricing coming soon" and the
 * interest form offers "Founding partner (rates on request)".
 * The page also refuses to show any tier still marked placeholder, so a
 * half-edited file never leaks placeholder prices.
 */

/** Feature flag. Keep false until John approves the real tiers. */
export const ADS_PACKAGES_APPROVED = false

export const COMING_SOON_COPY = 'Packages and pricing coming soon, contact us for founding-partner rates.'

/** Value the interest form sends when no tier is picked or tiers are not public yet. */
export const FOUNDING_PARTNER_TIER = { id: 'founding-partner', name: 'Founding partner (rates on request)' }

/**
 * PLACEHOLDER tiers. Not approved. Prices, slot lengths and counts below are
 * examples only and must not be shown publicly while placeholder is true.
 */
export const AD_PACKAGES = [
  {
    id: 'placeholder-local',
    placeholder: true, // PLACEHOLDER: not an approved tier
    name: 'PLACEHOLDER Local',
    priceLabel: 'PLACEHOLDER $—/mo',
    summary: 'PLACEHOLDER: one 10-second slot in the standard loop.',
    features: ['PLACEHOLDER: standard placement', 'PLACEHOLDER: 30-day run', 'PLACEHOLDER: monthly ride count report'],
  },
  {
    id: 'placeholder-featured',
    placeholder: true, // PLACEHOLDER: not an approved tier
    name: 'PLACEHOLDER Featured',
    priceLabel: 'PLACEHOLDER $—/mo',
    summary: 'PLACEHOLDER: a 15-second slot, shown first in the loop.',
    features: ['PLACEHOLDER: first-in-loop placement', 'PLACEHOLDER: deal QR code', 'PLACEHOLDER: weekly report'],
    highlight: true,
  },
  {
    id: 'placeholder-game-day',
    placeholder: true, // PLACEHOLDER: not an approved tier
    name: 'PLACEHOLDER Game Day',
    priceLabel: 'PLACEHOLDER $—/weekend',
    summary: 'PLACEHOLDER: takeover rotation on home game weekends.',
    features: ['PLACEHOLDER: game-day boost', 'PLACEHOLDER: takeover slot', 'PLACEHOLDER: built-for-you creative'],
  },
]

export const AD_CATEGORIES = [
  'Restaurant or bar',
  'Coffee or dessert',
  'Retail or apparel',
  'Fitness or wellness',
  'Salon or beauty',
  'Housing or apartments',
  'Services',
  'Events or entertainment',
  'Other',
]

/** Tiers the page may show publicly. Empty until the flag is on and tiers are real. */
export function publicAdPackages(packages = AD_PACKAGES, approved = ADS_PACKAGES_APPROVED) {
  if (!approved) return []
  return packages.filter((tier) => tier && !tier.placeholder)
}

/** Choices for the interest form's "Interested tier" select. */
export function tierChoices(packages = AD_PACKAGES, approved = ADS_PACKAGES_APPROVED) {
  return [FOUNDING_PARTNER_TIER, ...publicAdPackages(packages, approved).map(({ id, name }) => ({ id, name })), { id: 'not-sure', name: 'Not sure yet' }]
}
