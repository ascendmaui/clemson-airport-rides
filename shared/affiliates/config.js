/**
 * Affiliate program config. EVERY rate below is a PLACEHOLDER pending John's
 * approval (see the commission options memo). The database copy in
 * public.affiliate_config ('rates') is what the qualify trigger pays from; this
 * file is the default seed and what the UI shows when the row is missing.
 * Change rates via the admin view (POST /api/affiliates?action=admin-rates),
 * not by editing code.
 */
export const AFFILIATE_PARTNER_TYPES = ['student', 'campus_org', 'local_business', 'influencer']

export const AFFILIATE_PARTNER_LABELS = {
  student: 'Student',
  campus_org: 'Campus organization',
  local_business: 'Local business',
  influencer: 'Creator / influencer',
}

export const AFFILIATE_RATES_PLACEHOLDER = Object.freeze({
  placeholder: true,
  currency: 'usd',
  // Flat bounty per qualified referral, cents. PLACEHOLDER values.
  rider_first_ride_cents: 500,
  driver_first_trip_cents: 2500,
  // Optional per-type multiplier in basis points (10000 = 1x). PLACEHOLDER.
  partner_type_bps: { student: 10000, campus_org: 10000, local_business: 10000, influencer: 10000 },
  // Days a pending entry waits before it can be put in a payout batch.
  hold_days: 14,
  // Max paid qualified referrals per affiliate per calendar month (0 = no cap).
  monthly_cap: 50,
  // Minimum batch payout per affiliate, cents (smaller balances roll over).
  min_payout_cents: 1000,
})

export const AFFILIATE_MATERIALS_URL = 'https://drive.google.com/drive/folders/175gsf0tQEzpWnP41isKdT1lVyV-3HKuF'

export const AFFILIATE_LINK_ORIGIN = 'https://clemsonrides.com'

export const AFFILIATE_LEDGER_STATUSES = ['pending', 'approved', 'paid', 'void']
