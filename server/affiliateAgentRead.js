/**
 * Read-only snapshot of the affiliate program for draft text.
 * This module selects rows. It does not insert, update, delete, or pay.
 */

const READ_LIMIT = 500

function emptySnapshot() {
  return {
    available: false,
    affiliates: [],
    ledger: [],
    attributions: [],
    clickCount: null,
    rates: null,
  }
}

export async function readAffiliateSnapshot(sb) {
  if (!sb || typeof sb.from !== 'function') return emptySnapshot()
  try {
    const [affiliates, ledger, attributions, clicks, config] = await Promise.all([
      sb.from('affiliates').select('partner_type, status').limit(READ_LIMIT),
      sb.from('affiliate_ledger').select('status, amount_cents, kind').limit(READ_LIMIT),
      sb.from('affiliate_attributions').select('status, role').limit(READ_LIMIT),
      sb.from('affiliate_clicks').select('id', { count: 'exact', head: true }),
      sb.from('affiliate_config').select('value').eq('key', 'rates').maybeSingle(),
    ])
    if (affiliates?.error || ledger?.error || attributions?.error) return emptySnapshot()
    const rates = config?.error ? null : (config?.data?.value ?? null)
    return {
      available: true,
      affiliates: affiliates.data || [],
      ledger: ledger.data || [],
      attributions: attributions.data || [],
      clickCount: clicks?.error ? null : (clicks?.count ?? null),
      rates: rates && typeof rates === 'object' ? rates : null,
    }
  } catch {
    return emptySnapshot()
  }
}
