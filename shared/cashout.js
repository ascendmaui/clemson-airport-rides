/**
 * Instant cash-out rules shared by the API and the driver app.
 * Money math is integer cents. The calendar day is America/New_York.
 */
export const CASHOUT_TIME_ZONE = 'America/New_York'
export const DEFAULT_INSTANT_FEE_BPS = 150
export const DEFAULT_INSTANT_FEE_MIN_CENTS = 50

/** YYYY-MM-DD for the New York calendar day containing `now`. */
export function nyDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CASHOUT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now))
  const get = (type) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Same formula as claim_driver_cashout: max(min, ceil(gross * bps / 10000)). */
export function cashoutFeeCents(grossCents, { method = 'instant', feeBps = DEFAULT_INSTANT_FEE_BPS, feeMinCents = DEFAULT_INSTANT_FEE_MIN_CENTS } = {}) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0))
  if (method !== 'instant' || gross === 0) return 0
  return Math.max(Math.max(0, Math.round(feeMinCents)), Math.ceil((gross * Math.max(0, feeBps)) / 10000))
}

export function cashoutBreakdown(grossCents, opts = {}) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0))
  const fee = cashoutFeeCents(gross, opts)
  return { grossCents: gross, feeCents: fee, netCents: Math.max(0, gross - fee) }
}

/** Sum of trip payouts that the sweep would still pay (pending or failed). */
export function cashoutBalanceCents(trips) {
  let total = 0
  for (const trip of trips || []) {
    if (!['completed', 'cancelled_wait'].includes(trip?.status)) continue
    if (trip?.metadata?.e2e_test === true) continue
    const payout = trip?.metadata?.payout
    if (!payout || !['pending', 'failed'].includes(payout.status)) continue
    const cents = Math.round(Number(payout.amountCents) || 0)
    if (cents > 0) total += cents
  }
  return total
}

/** Pick the payout destination from a connected account's external accounts. */
export function payoutDestination(externalAccounts) {
  const list = Array.isArray(externalAccounts) ? externalAccounts : []
  const card = list.find((a) => a?.object === 'card' && (a.available_payout_methods || []).includes('instant'))
  if (card) return { method: 'instant', last4: card.last4 || null, brand: card.brand || null }
  const fallback = list.find((a) => a?.object === 'bank_account' || a?.object === 'card')
  if (fallback) return { method: 'standard', last4: fallback.last4 || null, brand: fallback.brand || fallback.bank_name || null, fallbackReason: 'instant_ineligible' }
  return null
}

/**
 * Decide what the Money tab shows. One of: needs_setup, already_today,
 * zero_balance, below_fee, ready.
 */
export function cashoutState({ connectAccountId, destination, balanceCents, cashedOutToday, feeBps, feeMinCents }) {
  if (!connectAccountId || !destination) return { state: 'needs_setup' }
  if (cashedOutToday) return { state: 'already_today' }
  const breakdown = cashoutBreakdown(balanceCents, { method: destination.method, feeBps, feeMinCents })
  if (breakdown.grossCents <= 0) return { state: 'zero_balance', ...breakdown, method: destination.method }
  if (breakdown.netCents <= 0) return { state: 'below_fee', ...breakdown, method: destination.method }
  return { state: 'ready', ...breakdown, method: destination.method, fallbackReason: destination.fallbackReason || null, last4: destination.last4 }
}

/** Stripe errors that mean "this account or card can't take instant payouts". */
export function isInstantIneligibleError(err) {
  const code = String(err?.code || err?.raw?.code || '')
  const msg = String(err?.message || '')
  if (['instant_payouts_unsupported', 'instant_payouts_limit_exceeded', 'instant_payouts_config_disabled'].includes(code)) return true
  return /instant/i.test(msg) && /(not|un)(\s|-)?(supported|eligible|available)|ineligible|limit/i.test(msg)
}

/** Refuse live Stripe keys unless explicitly enabled for cash-out. */
export function cashoutKeyAllowed(secretKey, env = {}) {
  const key = String(secretKey || '')
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return true
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return env.CASHOUT_LIVE_ENABLED === '1'
  return false
}

export const CASHOUT_COPY = {
  needs_setup: 'Add a debit card in payout setup to cash out.',
  already_today: 'You already cashed out today. Try again after midnight ET.',
  zero_balance: 'Nothing to cash out yet.',
  below_fee: 'Your balance is smaller than the instant fee.',
  payouts_on_hold: 'Payouts are paused for now. Your earnings are safe and show as pending payout.',
}

/**
 * The daily payout sweep runs at 12:00 UTC (pg_cron driver-payouts). Cash-out
 * is paused 11:50-12:30 UTC so a sweep transfer already in flight can't
 * overlap a claim. The claim itself also flips rows to cashout_pending, and
 * the sweep re-reads each row before transferring.
 */
export function sweepWindowBlocked(now = new Date()) {
  const d = new Date(now)
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return minutes >= 11 * 60 + 50 && minutes < 12 * 60 + 30
}
