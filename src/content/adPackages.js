/**
 * In-car tablet ad pricing for /advertise, sign-up and the server seed (ad_packages rows).
 *
 * Model: tablets are already in the cars. A business pays only for the number of rides its ad is
 * displayed in. Ads are spread across the drivers who have a paired tablet. Every ride is listed
 * on the partner's analytics page with its time and the QR scans it produced.
 *
 * THIS IS THE ONE FILE TO EDIT FOR PRICES. The ride bundles below are DRAFT prices told to John
 * and still pending his approval:
 *   1. Adjust RIDE_BUNDLES (rides and priceCents) and GAME_DAY_ADDON here.
 *   2. Mirror the numbers into the ad_packages rows (Admin desk > Tablet ads > Packages, or SQL).
 *   3. When John approves: flip ADS_PACKAGES_APPROVED to true, set the ad_packages rows to
 *      placeholder=false, active=true, run `node scripts/ads/sync-stripe-packages.mjs` (dry run),
 *      then `--apply` with ADS_BILLING_ENABLED=true.
 * Until then billing refuses these bundles (they are placeholder rows), the page labels them as
 * draft pricing, and nothing is ever charged.
 */

/** Pricing approval flag. Keep false until John approves the bundle prices. */
export const ADS_PACKAGES_APPROVED = false

export const PRICING_STATUS_COPY = 'Draft launch pricing, pending approval. Nothing is charged until your campaign is approved.'
/** Kept for older copy and tests: shown where no bundles are available. */
export const COMING_SOON_COPY = 'Packages and pricing coming soon, contact us for founding-partner rates.'

/** Value the interest form sends for founding partners (rates on request, by application). */
export const FOUNDING_PARTNER_TIER = { id: 'founding-partner', name: 'Founding partner (by application)' }

/** DRAFT ride bundles. Pay only for rides your ad is displayed in. */
export const RIDE_BUNDLES = [
  { id: 'rides-100', rides: 100, priceCents: 1200, name: '100 rides', summary: 'Try it on a weekend.' },
  { id: 'rides-250', rides: 250, priceCents: 2500, name: '250 rides', summary: 'A month of steady local reach.' },
  { id: 'rides-1000', rides: 1000, priceCents: 8900, name: '1,000 rides', summary: 'Best for regular weekly deals.', highlight: true },
  { id: 'rides-5000', rides: 5000, priceCents: 29900, name: '5,000 rides', summary: 'A full season of game days and nights out.' },
]

/** Optional add-on: extra weight in the rotation on home game weekends. Price set on request. */
export const GAME_DAY_ADDON = {
  id: 'game-day-weekend',
  name: 'Game-day weekend boost',
  priceCents: null,
  summary: 'Your ad plays more often on rides to and from home games, Friday to Sunday.',
}

/** Bundle lookup by id. */
export const bundleById = (id) => RIDE_BUNDLES.find((b) => b.id === id) || null

/** Per-ride price in cents (fractional), e.g. 8.9 for the 1,000 bundle. */
export const perRideCents = (bundle) => (bundle && bundle.rides > 0 ? Math.round((bundle.priceCents / bundle.rides) * 100) / 100 : null)

export const formatDollars = (cents) => (cents == null ? '' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`)
export const formatPerRide = (bundle) => {
  const c = perRideCents(bundle)
  return c == null ? '' : `${c.toLocaleString('en-US', { maximumFractionDigits: 1 })}¢ per ride`
}

/** ad_packages rows for the bundles (draft = placeholder until approved). Used by the migration test and admin. */
export function bundlePackageRows(approved = ADS_PACKAGES_APPROVED) {
  return [
    ...RIDE_BUNDLES.map((b, i) => ({
      id: b.id, kind: 'bundle', name: b.name, price_cents: b.priceCents, rides_included: b.rides,
      slot_seconds: 10, frequency: 1, placement: 'standard', duration_days: 120, game_day_boost: 1,
      active: approved, placeholder: !approved, sort: 100 + i * 10,
    })),
    {
      id: GAME_DAY_ADDON.id, kind: 'addon', name: GAME_DAY_ADDON.name, price_cents: 0, rides_included: null,
      slot_seconds: 10, frequency: 1, placement: 'standard', duration_days: 3, game_day_boost: 2,
      active: false, placeholder: true, sort: 200,
    },
  ]
}

export const AD_CATEGORIES = [
  'Restaurant or bar',
  'Coffee or dessert',
  'Retail or apparel',
  'Fitness or wellness',
  'Salon or beauty',
  'Housing or apartments',
  'Tutoring or services',
  'Events or entertainment',
  'Other',
]

/** Bundles the page may show. Draft bundles show with the pending-approval label. */
export function publicAdPackages(bundles = RIDE_BUNDLES) {
  return bundles.filter((b) => b && b.rides > 0 && b.priceCents > 0)
}

/** Choices for the interest form's "Interested in" select. */
export function tierChoices(bundles = RIDE_BUNDLES) {
  return [FOUNDING_PARTNER_TIER, ...publicAdPackages(bundles).map(({ id, name }) => ({ id, name: `${name} bundle` })), { id: 'not-sure', name: 'Not sure yet' }]
}
