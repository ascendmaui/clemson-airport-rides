/**
 * Affiliate commission defaults — Option C.
 * The database copy in public.affiliate_config ('rates') is what the qualify
 * trigger pays from. This object is the seed and the fallback when that row
 * is missing. Change live rates in the admin view
 * (POST /api/affiliates?action=admin-rates), not by scattering numbers
 * through the UI.
 *
 * Partner-type bonuses below are proposed defaults for John to confirm.
 * Students stay at 1x. Campus groups and local businesses are 1.25x.
 * Creators are 1.5x.
 */
export const AFFILIATE_PARTNER_TYPES = ['student', 'campus_org', 'local_business', 'influencer']

export const AFFILIATE_PARTNER_LABELS = {
  student: 'Student',
  campus_org: 'Campus group',
  local_business: 'Local business',
  influencer: 'Creator',
}

export const AFFILIATE_RATES_DEFAULTS = Object.freeze({
  plan: 'option_c',
  // Base amounts are the selected Option C plan. The partner-type bonuses
  // are still proposed — John to confirm before they are treated as final.
  placeholder: false,
  multipliers_pending_confirmation: true,
  multipliers_note: 'Proposed partner-type bonuses for John to confirm: campus groups 1.25x, local businesses 1.25x, creators 1.5x. Students stay at 1x.',
  currency: 'usd',
  // $4 once a referred rider's first completed fare is at least rider_min_fare_cents.
  rider_first_ride_cents: 400,
  rider_min_fare_cents: 1500,
  // $20 when a referred driver finishes their first trip.
  driver_first_trip_cents: 2000,
  // Basis points. 10000 = 1x, 12500 = 1.25x, 15000 = 1.5x.
  partner_type_bps: { student: 10000, campus_org: 12500, local_business: 12500, influencer: 15000 },
  hold_days: 14,
  monthly_cap: 50,
  min_payout_cents: 1000,
})

/** @deprecated Use AFFILIATE_RATES_DEFAULTS. Kept so older imports keep working. */
export const AFFILIATE_RATES_PLACEHOLDER = AFFILIATE_RATES_DEFAULTS

export const AFFILIATE_MATERIALS_URL = 'https://drive.google.com/drive/folders/175gsf0tQEzpWnP41isKdT1lVyV-3HKuF'

export const AFFILIATE_LINK_ORIGIN = 'https://clemsonrides.com'

export const AFFILIATE_LEDGER_STATUSES = ['pending', 'approved', 'paid', 'void']
