/**
 * GET  /api/driver?action=payout-approvals               the signed-in driver's own requests
 * GET  /api/driver?action=payout-approvals&scope=admin   approver queue (johnmatveyev@gmail.com only)
 * POST /api/driver?action=payout-approvals  { id, decision: 'approve'|'reject', reason? }  approver only
 *
 * Approve runs the Stripe transfer/payout once, with an idempotency key tied
 * to the request. Reject releases the amount back to the driver's balance.
 */
import { admin, cors, json, parseBody, stripeClient, userFromAuth } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { decideApproval, loadApprovalById } from '../payoutApproval.js'
import { rerunApprovalSource } from '../payoutApprovalExecute.js'
import { PAYOUT_HOLD_ERROR, payoutsHeld } from '../payoutHold.js'
import { approvalKindLabel, isPayoutApprover, publicApprovalRow } from '../../shared/payoutApproval.js'

function scopeOf(req) {
  const q = req?.query
  if (q && typeof q === 'object' && q.scope) return String(Array.isArray(q.scope) ? q.scope[0] : q.scope)
  const url = String(req?.url || '')
  const i = url.indexOf('?')
  return i === -1 ? '' : (new URLSearchParams(url.slice(i + 1)).get('scope') || '')
}

async function adminQueue(sb) {
  const [pending, recent] = await Promise.all([
    sb.from('payout_approval_requests').select('*').eq('status', 'pending_approval')
      .order('requested_at', { ascending: true }).limit(200),
    sb.from('payout_approval_requests').select('*').neq('status', 'pending_approval')
      .order('updated_at', { ascending: false }).limit(50),
  ])
  if (pending?.error) throw new Error(pending.error.message)
  if (recent?.error) throw new Error(recent.error.message)
  const rows = [...(pending.data || []), ...(recent.data || [])]
  const ids = [...new Set(rows.map((r) => r.payee_id).filter(Boolean))]
  const names = new Map()
  if (ids.length) {
    const people = await sb.from('profiles').select('id, full_name, email').in('id', ids)
    for (const p of people?.data || []) names.set(p.id, p)
  }
  const shape = (row) => ({
    ...publicApprovalRow(row),
    driverId: row.payee_id,
    driverName: names.get(row.payee_id)?.full_name || null,
    driverEmail: names.get(row.payee_id)?.email || null,
    kindLabel: approvalKindLabel(row.kind),
    decidedByEmail: row.decided_by_email || null,
    lastError: row.last_error || null,
  })
  return {
    pending: (pending.data || []).map(shape),
    recent: (recent.data || []).map(shape),
  }
}

export default async function handlePayoutApprovals(req, res, deps = {}) {
  if (cors(req, res)) return
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const env = deps.env || process.env
  const approver = isPayoutApprover(user)
  try {
    if (req.method === 'GET') {
      if (scopeOf(req) === 'admin') {
        if (!approver) return json(res, 403, { error: 'payout_approver_only' })
        return json(res, 200, { approver: true, ...(await adminQueue(sb)) })
      }
      const mine = await sb.from('payout_approval_requests')
        .select('id, kind, amount_cents, status, reject_reason, requested_at, decided_at, sent_at, trip_id')
        .eq('payee_id', user.id).order('requested_at', { ascending: false }).limit(50)
      if (mine?.error) return json(res, 500, { error: mine.error.message })
      return json(res, 200, { approver, requests: (mine.data || []).map(publicApprovalRow) })
    }
    if (!approver) return json(res, 403, { error: 'payout_approver_only' })
    const blocked = stagingCronBlock(env, { dryRun: false })
    if (blocked) return json(res, blocked.status, blocked.body)
    const { body, error } = parseBody(req)
    if (error) return json(res, 400, { error })
    const id = String(body?.id || '').trim()
    const decision = body?.decision
    if (!id) return json(res, 400, { error: 'id_required' })
    // Payouts hold: approving would move money. Rejecting is still allowed.
    if (decision === 'approve' && await payoutsHeld({ sb, env })) return json(res, 409, { error: PAYOUT_HOLD_ERROR })
    const decided = await decideApproval(sb, { id, decision, actor: { id: user.id, email: user.email }, reason: body?.reason })
    if (!decided.ok) return json(res, decided.status || 500, { error: decided.error })
    const stripe = deps.stripe !== undefined ? deps.stripe : stripeClient()
    let result
    try {
      result = await (deps.rerunApprovalSource || rerunApprovalSource)({ sb, stripe, request: decided.request, env })
    } catch (err) {
      console.error('[payout-approvals] run', err?.message)
      result = { ok: false, error: 'run_failed', detail: err?.message }
    }
    const fresh = await loadApprovalById(sb, id)
    return json(res, 200, { ok: true, decision, request: publicApprovalRow(fresh || decided.request), result })
  } catch (err) {
    console.error('[payout-approvals]', err?.message)
    return json(res, 500, { error: 'payout_approvals_failed' })
  }
}
