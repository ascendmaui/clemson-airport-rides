/**
 * Admin approval gate for live driver money. Pure helpers shared by the server,
 * the web app and the native apps. See server/payoutApproval.js.
 */

/** Sole payout approver. Hard-coded: an env list or profile flag cannot widen it. */
export const PAYOUT_APPROVER_EMAILS = Object.freeze(['johnmatveyev@gmail.com'])

export const APPROVAL_STATUSES = Object.freeze([
  'pending_approval', 'approved', 'sent', 'rejected', 'failed', 'superseded',
])

export const APPROVAL_KINDS = Object.freeze([
  'cashout', 'trip_payout', 'wait_cancel', 'tip', 'standby', 'cancel_fee', 'switch_fee', 'bonus', 'affiliate',
])

const KIND_LABELS = {
  cashout: 'Cash out',
  trip_payout: 'Trip payout',
  wait_cancel: 'Wait payout',
  tip: 'Tip',
  standby: 'Backup standby',
  cancel_fee: 'Cancel fee',
  switch_fee: 'Switch fee',
  bonus: 'Bonus',
  affiliate: 'Affiliate',
}

export function approvalKindLabel(kind) {
  return KIND_LABELS[kind] || 'Payout'
}

export function isLiveStripeKey(key) {
  const k = String(key || '')
  return k.startsWith('sk_live_') || k.startsWith('rk_live_')
}

/**
 * True when every driver transfer/payout needs admin approval first.
 * Always on with a live Stripe key. PAYOUT_APPROVAL_REQUIRED=1 turns it on in
 * test mode too (staging).
 */
export function payoutApprovalRequired(env = {}) {
  if (isLiveStripeKey(env?.STRIPE_SECRET_KEY)) return true
  const flag = String(env?.PAYOUT_APPROVAL_REQUIRED ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

export function normalizeApproverEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/** Server-side check on the Supabase auth user (verified email only). */
export function isPayoutApprover(user) {
  if (!user || typeof user !== 'object') return false
  const email = normalizeApproverEmail(user.email)
  if (!PAYOUT_APPROVER_EMAILS.includes(email)) return false
  // Supabase sets email_confirmed_at (or confirmed_at). Refuse an unconfirmed address.
  return Boolean(user.email_confirmed_at || user.confirmed_at)
}

/** Driver-facing status text. */
export function approvalStatusLabel(row) {
  const status = row?.status
  if (status === 'pending_approval') return 'Pending approval'
  if (status === 'approved') return 'Approved, sending'
  if (status === 'sent') return 'Approved and sent'
  if (status === 'rejected') {
    const reason = String(row?.reject_reason ?? row?.rejectReason ?? '').trim()
    return reason ? `Rejected: ${reason}` : 'Rejected'
  }
  if (status === 'failed') return 'Approved, send failed. Retrying'
  if (status === 'superseded') return 'Paid another way'
  return 'Pending approval'
}

/** Row shape returned to a driver. No Stripe ids, no destination. */
export function publicApprovalRow(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: approvalKindLabel(row.kind),
    amountCents: Math.max(0, Math.round(Number(row.amount_cents) || 0)),
    status: row.status,
    statusLabel: approvalStatusLabel(row),
    rejectReason: row.status === 'rejected' ? (row.reject_reason || null) : null,
    requestedAt: row.requested_at || null,
    decidedAt: row.decided_at || null,
    sentAt: row.sent_at || null,
    tripId: row.trip_id || null,
  }
}

export function cleanRejectReason(reason) {
  const text = String(reason ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 500) : null
}

export const PAYOUT_APPROVAL_COPY = Object.freeze({
  cashoutPending: 'Cash out requested. It shows as Pending approval until it is approved, then it is sent.',
  reonboard: 'Payouts moved to a new Stripe account. Set up direct deposit again to get paid.',
  sectionTitle: 'Payout requests',
  empty: 'Payout requests show up here while they wait for approval.',
})
