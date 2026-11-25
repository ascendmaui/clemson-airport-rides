/**
 * Admin approval gate for live driver money.
 *
 * Every live Stripe transfer or payout to a driver calls payoutGate() first.
 * The first call for a source (one trip payout, one tip, one cash-out, one
 * bonus row) inserts a payout_approval_requests row in pending_approval and
 * returns { allowed: false }. Nothing moves until the sole approver approves
 * it. After approval the caller sends with approvalIdempotencyKey(request),
 * so a retry or a concurrent run can never pay twice, then records the result
 * with markApprovalSent / markApprovalFailed.
 *
 * In test mode (sk_test_) the gate is off unless PAYOUT_APPROVAL_REQUIRED=1.
 */
import { adminNotifyRecipients } from './adminRoster.js'
import { WEB_ORIGIN } from '../shared/productLinks.js'
import {
  approvalKindLabel, cleanRejectReason, isLiveStripeKey, payoutApprovalRequired,
} from '../shared/payoutApproval.js'

const TABLE = 'payout_approval_requests'
const EVENTS = 'payout_approval_events'

function missingRelation(error) {
  return /schema cache|does not exist|could not find the table|relation/i.test(error?.message || error || '')
}

function usd(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`
}

export async function recordApprovalEvent(sb, { requestId, action, actor = null, amountCents = null, note = null }) {
  try {
    const res = await sb.from(EVENTS).insert({
      request_id: requestId,
      action,
      actor_id: actor?.id || null,
      actor_email: actor?.email || null,
      amount_cents: amountCents,
      note: note ? String(note).slice(0, 500) : null,
    })
    if (res?.error && !missingRelation(res.error)) console.error('[payout-approval] audit', res.error.message)
  } catch (err) {
    console.error('[payout-approval] audit', err?.message || err)
  }
}

export async function loadApprovalBySource(sb, sourceRef) {
  const res = await sb.from(TABLE).select('*').eq('source_ref', sourceRef).maybeSingle()
  if (res?.error) throw new Error(res.error.message)
  return res?.data || null
}

export async function loadApprovalById(sb, id) {
  const res = await sb.from(TABLE).select('*').eq('id', id).maybeSingle()
  if (res?.error) throw new Error(res.error.message)
  return res?.data || null
}

/** Stripe idempotency key for an approved request. attempts only grows after a definite 4xx. */
export function approvalIdempotencyKey(request, suffix = 'transfer') {
  return `approval:${request.id}:${suffix}:${Number(request.attempts) || 0}`
}

/**
 * Gate one money movement.
 * Returns:
 *   { allowed: true, bypass: true }                gate off (test mode)
 *   { allowed: true, request }                     approved (or failed earlier and retrying)
 *   { allowed: false, alreadySent: true, request } paid already; use request.stripe_transfer_id
 *   { allowed: false, status: 'pending_approval'|'rejected'|'superseded', request }
 */
export async function payoutGate({
  sb, env = process.env, kind, sourceRef, payeeId, amountCents, sourceId = null, tripId = null,
  destination = null, details = {}, notify = notifyAdminOfPayoutRequest,
}) {
  if (!payoutApprovalRequired(env)) return { allowed: true, bypass: true }
  if (!sb || typeof sb.from !== 'function') return { allowed: false, status: 'approval_unavailable' }
  const cents = Math.max(0, Math.round(Number(amountCents) || 0))
  if (!cents) return { allowed: true, bypass: true, zero: true }
  let request = await loadApprovalBySource(sb, sourceRef)
  if (!request) {
    const inserted = await sb.from(TABLE).insert({
      source_ref: sourceRef,
      kind,
      payee_id: payeeId,
      amount_cents: cents,
      source_id: sourceId != null ? String(sourceId) : null,
      trip_id: tripId || null,
      destination_account: destination || null,
      details: details || {},
      status: 'pending_approval',
    }).select('*').maybeSingle()
    if (inserted?.error) {
      // Lost a race with another run: read the winner.
      if (/duplicate|unique/i.test(inserted.error.message || '')) {
        request = await loadApprovalBySource(sb, sourceRef)
      } else {
        throw new Error(inserted.error.message)
      }
    } else {
      request = inserted?.data || await loadApprovalBySource(sb, sourceRef)
      if (request) {
        await recordApprovalEvent(sb, { requestId: request.id, action: 'requested', amountCents: cents })
        try { await notify?.(sb, request, env) } catch (err) { console.error('[payout-approval] notify', err?.message) }
      }
    }
  }
  if (!request) return { allowed: false, status: 'approval_unavailable' }
  if (request.status === 'sent') return { allowed: false, alreadySent: true, request }
  if (request.status === 'approved' || request.status === 'failed') {
    // The amount the approver saw is the amount that may move.
    if (Number(request.amount_cents) !== cents) {
      return { allowed: false, status: 'amount_changed', request }
    }
    return { allowed: true, request }
  }
  return { allowed: false, status: request.status, request }
}

export async function markApprovalSent(sb, request, { transferId = null, payoutId = null } = {}) {
  if (!request?.id) return
  const res = await sb.from(TABLE).update({
    status: 'sent',
    stripe_transfer_id: transferId,
    stripe_payout_id: payoutId,
    last_error: null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', request.id)
  if (res?.error) console.error('[payout-approval] sent', res.error.message)
  await recordApprovalEvent(sb, { requestId: request.id, action: 'sent', amountCents: request.amount_cents, note: transferId || payoutId })
}

/** definite: Stripe answered 4xx, so no money moved and the next try may use a new idempotency key. */
export async function markApprovalFailed(sb, request, error, { definite = false } = {}) {
  if (!request?.id) return
  const message = String(error?.message || error || 'send_failed').slice(0, 500)
  const res = await sb.from(TABLE).update({
    status: 'failed',
    last_error: message,
    attempts: (Number(request.attempts) || 0) + (definite ? 1 : 0),
    updated_at: new Date().toISOString(),
  }).eq('id', request.id)
  if (res?.error) console.error('[payout-approval] failed', res.error.message)
  await recordApprovalEvent(sb, { requestId: request.id, action: 'failed', amountCents: request.amount_cents, note: message })
}

export async function markApprovalSuperseded(sb, request, note) {
  if (!request?.id) return
  await sb.from(TABLE).update({ status: 'superseded', last_error: note || null, updated_at: new Date().toISOString() })
    .eq('id', request.id).in('status', ['pending_approval', 'approved', 'failed'])
  await recordApprovalEvent(sb, { requestId: request.id, action: 'superseded', amountCents: request.amount_cents, note })
}

/** A 4xx from Stripe means nothing was created. */
export function isDefiniteStripeError(err) {
  const code = Number(err?.statusCode ?? err?.raw?.statusCode)
  if (err?.type === 'StripeIdempotencyError') return false
  return Number.isFinite(code) && code >= 400 && code < 500
}

/** Approver decision. Only pending_approval rows move; returns the updated row or an error code. */
export async function decideApproval(sb, { id, decision, actor, reason = null }) {
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, status: 400, error: 'bad_decision' }
  const now = new Date().toISOString()
  const patch = decision === 'approve'
    ? { status: 'approved', decided_by: actor?.id || null, decided_by_email: actor?.email || null, decided_at: now, updated_at: now }
    : { status: 'rejected', decided_by: actor?.id || null, decided_by_email: actor?.email || null, decided_at: now, updated_at: now, reject_reason: cleanRejectReason(reason) }
  const res = await sb.from(TABLE).update(patch).eq('id', id).eq('status', 'pending_approval').select('*').maybeSingle()
  if (res?.error) return { ok: false, status: 500, error: res.error.message }
  if (!res?.data) {
    const current = await loadApprovalById(sb, id)
    if (!current) return { ok: false, status: 404, error: 'not_found' }
    return { ok: false, status: 409, error: 'not_pending', request: current }
  }
  await recordApprovalEvent(sb, {
    requestId: id,
    action: decision === 'approve' ? 'approved' : 'rejected',
    actor,
    amountCents: res.data.amount_cents,
    note: decision === 'reject' ? patch.reject_reason : null,
  })
  return { ok: true, request: res.data }
}

/**
 * Connect account usable with the current key? A test-mode account (or one
 * from another platform) is invisible to a live key: Stripe answers
 * resource_missing / permission errors. Those drivers must onboard again.
 */
export async function connectAccountState(stripe, accountId) {
  if (!accountId) return { ok: false, reason: 'no_connect_account' }
  if (!stripe?.accounts?.retrieve) return { ok: true, account: null }
  try {
    const account = await stripe.accounts.retrieve(accountId)
    if (!account?.id) return { ok: false, reason: 'needs_reonboard' }
    return { ok: true, account }
  } catch (err) {
    const code = err?.code || err?.raw?.code
    const type = err?.type || ''
    const message = String(err?.message || '')
    if (code === 'resource_missing' || code === 'account_invalid' || type === 'StripePermissionError'
      || Number(err?.statusCode) === 404
      || /no such account|test mode|live mode|does not have access|not connected to your platform/i.test(message)) {
      return { ok: false, reason: 'needs_reonboard' }
    }
    throw err
  }
}

/** Only live keys need the check; test keys and mocks keep the stored id. */
export async function usableConnectAccount(stripe, accountId, env = process.env) {
  if (!accountId) return { accountId: null, needsReonboard: false }
  if (!isLiveStripeKey(env?.STRIPE_SECRET_KEY)) return { accountId, needsReonboard: false }
  const state = await connectAccountState(stripe, accountId)
  if (state.ok) return { accountId, account: state.account, needsReonboard: false }
  return { accountId: null, staleAccountId: accountId, needsReonboard: true }
}

/** Admin notification row (admin Notifications tab) plus email when Resend is configured. */
export async function notifyAdminOfPayoutRequest(sb, request, env = process.env) {
  const label = approvalKindLabel(request.kind)
  const title = `Payout approval: ${label} ${usd(request.amount_cents)}`
  const body = `A ${label.toLowerCase()} of ${usd(request.amount_cents)} is waiting for your approval. Nothing is sent until you approve it.`
  try {
    const inserted = await sb.from('admin_notifications').insert({
      kind: 'other', title: title.slice(0, 140), body: body.slice(0, 500),
      entity_type: 'payout_request', entity_id: String(request.id),
    })
    if (inserted?.error && !missingRelation(inserted.error)) console.error('[payout-approval] notification', inserted.error.message)
  } catch (err) {
    console.error('[payout-approval] notification', err?.message)
  }
  const key = String(env?.RESEND_API_KEY || '').trim()
  const from = String(env?.RESEND_FROM || '').trim()
  const to = adminNotifyRecipients(env)
  if (!key || key.includes('placeholder') || !from || !to.length || typeof fetch !== 'function') return { emailed: false }
  const appUrl = String(env?.VITE_APP_URL || env?.APP_URL || WEB_ORIGIN).replace(/\/$/, '')
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to, subject: title,
        text: `${body}\n\nReview it: ${appUrl}/#/admin?tab=payouts`,
      }),
    })
    return { emailed: res.ok }
  } catch (err) {
    console.error('[payout-approval] email', err?.message)
    return { emailed: false }
  }
}
