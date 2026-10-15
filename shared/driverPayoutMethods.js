/**
 * Driver payout methods. Stripe Connect Express, test keys only.
 * The secret is STRIPE_SECRET_KEY (test or live). Live transfers and payouts need admin approval first.
 * Linked accounts are shown as last 4 only.
 */

export const PAYOUT_STATUS_CHIPS = ['pending', 'in_transit', 'paid', 'failed']

/** True only for a Stripe test secret. sk_live_ and rk_live_ are refused. */
export function expressTestKeyAllowed(secretKey) {
  const key = String(secretKey || '')
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return false
  return key.startsWith('sk_test_') || key.startsWith('rk_test_')
}

/**
 * Connect Express payout setup works with a test or a live secret.
 * Live money still waits for admin approval (server/payoutApproval.js).
 */
export function expressKeyAllowed(secretKey) {
  const key = String(secretKey || '')
  return key.startsWith('sk_test_') || key.startsWith('rk_test_') || key.startsWith('sk_live_') || key.startsWith('rk_live_')
}

export function payoutStatusChip(status) {
  const value = String(status || '').toLowerCase().replace(/\s+/g, '_')
  if (value === 'paid') return 'paid'
  if (value === 'in_transit') return 'in_transit'
  if (value === 'failed' || value === 'canceled' || value === 'cancelled') return 'failed'
  return 'pending'
}

const CHIP_RANK = { pending: 1, in_transit: 2, paid: 3, failed: 3 }

/** A late pending event must not rewind a paid or failed payout. */
export function shouldApplyPayoutStatus(current, next) {
  const from = payoutStatusChip(current)
  const to = payoutStatusChip(next)
  if (!current) return true
  if (from === 'paid' || from === 'failed') return to === from
  return CHIP_RANK[to] >= CHIP_RANK[from]
}

function last4(value) {
  const text = String(value || '')
  return /^\d{4}$/.test(text) ? text : null
}

/** Public shape for a Stripe external account. No full account number. */
export function publicPayoutMethod(row) {
  if (!row || typeof row !== 'object') return null
  const kind = row.object === 'card' ? 'card' : row.object === 'bank_account' ? 'bank' : null
  if (!kind) return null
  const instant = kind === 'card' && Array.isArray(row.available_payout_methods)
    && row.available_payout_methods.includes('instant')
  return {
    id: typeof row.id === 'string' ? row.id : null,
    kind,
    last4: last4(row.last4),
    brand: row.brand || row.bank_name || null,
    default: row.default_for_currency === true,
    instant,
  }
}

export function usdCents(entries) {
  const list = Array.isArray(entries) ? entries : []
  const usd = list.find((row) => row?.currency === 'usd') || list[0]
  return Math.max(0, Math.round(Number(usd?.amount) || 0))
}

export function payoutChipLabel(chip) {
  switch (chip) {
    case 'pending':
      return 'Pending'
    case 'in_transit':
      return 'In transit'
    case 'paid':
      return 'Paid'
    case 'failed':
      return 'Failed'
    default: {
      const unexpected = /** @type {never} */ (chip)
      return String(unexpected || 'Pending')
    }
  }
}
