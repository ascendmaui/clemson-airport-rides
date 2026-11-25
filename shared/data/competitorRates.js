/**
 * Competitor rate cards for Clemson, SC (seed for public.competitor_rate_cards
 * and the offline default for scripts/pricing/compare-competitors.mjs).
 * Numbers are copied from the cited pages only. See docs/pricing-competitor-check.md.
 *
 * minIncludesBooking: true when the minimum fare is the all-in floor (Uber's
 * minimum includes the booking fee); false when the service fee is added on
 * top of the minimum (Lyft lists the service fee as a separate line).
 */
export const COMPETITOR_RATES_FETCHED_AT = '2026-10-17T09:30:00Z'

export const COMPETITOR_RATES = Object.freeze([
  {
    competitor: 'uber', tier: 'uberx', ourTier: 'standard',
    baseCents: 119, bookingFeeCents: 265, perMileCents: 114, perMinuteCents: 18, minFareCents: 590, minIncludesBooking: true,
    sourceUrl: 'https://uphail.com/us/sc/clemson/', sourceKind: 'third_party',
    notes: 'Uber publishes no Clemson rate card (uber.com city page shows only average route prices). UpHail Clemson UberX table: base $1.19, $1.14/mi, $0.18/min, Safe Ride fee $2.65, minimum $5.90.',
  },
  {
    competitor: 'uber', tier: 'uber_comfort', ourTier: 'comfort',
    baseCents: 178, bookingFeeCents: 345, perMileCents: 131, perMinuteCents: 24, minFareCents: 1069, minIncludesBooking: true,
    sourceUrl: 'https://uphail.com/us/sc/clemson/', sourceKind: 'third_party',
    notes: 'UpHail Clemson Uber Comfort table: base $1.78, $1.31/mi, $0.24/min, Safe Ride fee $3.45, minimum $10.69.',
  },
  {
    competitor: 'lyft', tier: 'lyft_standard', ourTier: 'standard',
    baseCents: 80, bookingFeeCents: 325, perMileCents: 114, perMinuteCents: 17, minFareCents: 307, minIncludesBooking: false,
    sourceUrl: 'https://www.lyft.com/pricing/GSP', sourceKind: 'official_snapshot',
    notes: 'Lyft official Greenville-area (GSP region, covers Clemson) pricing page as indexed by web search on 2026-10-17: base $0.80, $1.14/mi, $0.17/min, service fee $3.25, minimum $3.07, plus 1% SC assessment. Direct fetch returned 404 that day. UpHail lists base $1.20 with no service fee.',
  },
  {
    competitor: 'lyft', tier: 'lyft_extra_comfort', ourTier: 'comfort',
    baseCents: 137, bookingFeeCents: 345, perMileCents: 150, perMinuteCents: 18, minFareCents: 398, minIncludesBooking: false,
    sourceUrl: 'https://www.lyft.com/pricing/GSP', sourceKind: 'official_snapshot',
    notes: 'Lyft official GSP-region Extra Comfort (search-index snapshot 2026-10-17): base $1.37, $1.50/mi, $0.18/min, service fee $3.45, minimum $3.98.',
  },
].map((row) => Object.freeze(row)))
