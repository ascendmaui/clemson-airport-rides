/**
 * User-visible driver earnings and payout copy normalization.
 * Standardizes labels, status descriptions, breakdown notes, and incentive names
 * across driver mobile and web applications without altering underlying money math.
 */

export const DRIVER_SHARE_PERCENT = 80
export const PLATFORM_FEE_PERCENT = 20

export const PAYOUT_STATUS_LABELS = Object.freeze({
  pending: 'Pending transfer',
  processing: 'Processing transfer',
  paid: 'Paid out',
  failed: 'Transfer failed (retry scheduled)',
  canceled: 'Transfer canceled',
})

export const PAYOUT_STATUS_BADGE_TONES = Object.freeze({
  pending: 'orange',
  processing: 'orange',
  paid: 'green',
  failed: 'danger',
  canceled: 'neutral',
})

export const INCENTIVE_LABELS = Object.freeze({
  driver_carpool_bonus: 'Carpool bonus',
  student_discount: 'Student discount',
  game_day_surge: 'Game Day surge',
  airport_bonus: 'Airport bonus',
})

/**
 * Returns a human-friendly name for incentive identifiers instead of raw database keys.
 *
 * @param {string | null | undefined} rawId - Incentive ID (e.g. 'driver_carpool_bonus')
 * @returns {string} Human-friendly title
 */
export function formatIncentiveName(rawId) {
  if (!rawId || typeof rawId !== 'string') return 'Bonus incentive'
  const key = rawId.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(INCENTIVE_LABELS, key)) {
    return INCENTIVE_LABELS[key]
  }
  // Convert snake_case or kebab-case to Title Case words
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Returns standardized display label for a payout status.
 *
 * @param {string | null | undefined} status - Raw status (e.g. 'pending', 'paid')
 * @returns {string} Human-readable status label
 */
export function getPayoutStatusLabel(status) {
  if (!status || typeof status !== 'string') return 'Pending'
  const key = status.trim().toLowerCase()
  return PAYOUT_STATUS_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1))
}

/**
 * Returns consistent theme tone ('orange', 'green', 'danger', 'neutral') for a payout status.
 *
 * @param {string | null | undefined} status - Raw status
 * @returns {string} Tone identifier
 */
export function getPayoutStatusBadgeTone(status) {
  if (!status || typeof status !== 'string') return 'orange'
  const key = status.trim().toLowerCase()
  return PAYOUT_STATUS_BADGE_TONES[key] || 'neutral'
}

/**
 * Formats user-facing copy for weekly earnings notes, avoiding internal schema column names.
 *
 * @param {Object} options
 * @param {number} options.weekNetCents - Net weekly earnings in cents
 * @param {boolean} [options.hasCarpoolBonus=false] - Whether week includes carpool bonuses
 * @returns {string} Clear explanatory note
 */
export function formatWeeklyEarningsNote({ weekNetCents = 0, hasCarpoolBonus = false } = {}) {
  if (weekNetCents <= 0) {
    return 'No completed trips this week. You keep 80% of each fare once a ride finishes, plus any carpool bonuses.'
  }
  if (hasCarpoolBonus) {
    return 'This week includes carpool payouts, with bonus incentives added on top of your 80% fare share.'
  }
  return 'This week’s total is the 80% you keep. Open details for day, week, month, and year.'
}

/**
 * Formats user-facing copy for the customer fare breakdown card.
 *
 * @param {Object} options
 * @param {boolean} [options.standard=false] - True if no completed trips exist yet
 * @param {boolean} [options.hasCarpoolBonus=false] - True if trips include carpool bonuses
 * @returns {string} Explanatory breakdown text
 */
export function formatFareBreakdownExplanation({ standard = false, hasCarpoolBonus = false } = {}) {
  if (standard) {
    return 'No completed trips yet. The chart shows the standard split until one is on file. You keep 80%.'
  }
  if (hasCarpoolBonus) {
    return 'Completed trips on this account. You keep 80% of the fare, plus bonus incentives on carpools. Tips sit in Other.'
  }
  return 'Completed trips on this account. You keep 80% of the fare. Tips, when present, sit in Other.'
}

/**
 * Formats user-facing wallet and balance description.
 *
 * @param {Object} options
 * @param {number} options.pendingCents - Current pending balance
 * @param {string | null} [options.nextRetryAt] - Next scheduled retry ISO timestamp
 * @returns {string} Wallet status note
 */
export function formatWalletBalanceNote({ pendingCents = 0, nextRetryAt = null } = {}) {
  if (nextRetryAt) {
    const formatted = new Date(nextRetryAt).toLocaleString()
    return `Next payout retry scheduled for ${formatted}.`
  }
  if (pendingCents > 0) {
    return 'This balance pays out automatically when a Stripe transfer is due.'
  }
  return 'Nothing is waiting to pay out. Completed trips land here after Stripe records them.'
}
