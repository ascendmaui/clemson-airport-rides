/**
 * Instant cash-out. Claim (DB, one per NY day) -> transfer -> payout.
 * The claim moves trip payouts to cashout_pending so the daily sweep skips
 * them; settle marks them paid or returns them to pending.
 */
import {
  DEFAULT_INSTANT_FEE_BPS, DEFAULT_INSTANT_FEE_MIN_CENTS, cashoutBalanceCents, cashoutBreakdown,
  cashoutKeyAllowed, cashoutState, sweepWindowBlocked, isInstantIneligibleError, nyDay, payoutDestination,
} from '../shared/cashout.js'
import { loadConnectAccount } from './payouts.js'
import {
  approvalIdempotencyKey, isDefiniteStripeError, loadApprovalBySource, markApprovalFailed, markApprovalSent,
  payoutGate, usableConnectAccount,
} from './payoutApproval.js'
import { payoutApprovalRequired } from '../shared/payoutApproval.js'

export function cashoutFeeConfig(env = process.env) {
  const bps = Number(env.CASHOUT_INSTANT_FEE_BPS)
  const min = Number(env.CASHOUT_INSTANT_FEE_MIN_CENTS)
  return {
    feeBps: Number.isFinite(bps) && bps >= 0 ? bps : DEFAULT_INSTANT_FEE_BPS,
    feeMinCents: Number.isFinite(min) && min >= 0 ? min : DEFAULT_INSTANT_FEE_MIN_CENTS,
  }
}

async function listDestinations(stripe, account) {
  if (!stripe?.accounts?.listExternalAccounts) return []
  const res = await stripe.accounts.listExternalAccounts(account, { limit: 10 })
  return res?.data || []
}

export async function cashedOutToday(sb, driverId, now = new Date()) {
  const res = await sb.from('driver_cashouts').select('id, status')
    .eq('driver_id', driverId).eq('ny_day', nyDay(now)).neq('status', 'failed').limit(1)
  if (res.error) throw new Error(res.error.message)
  return (res.data || []).length > 0
}

function destinationForMethod(destination, method) {
  if (method !== 'instant' && method !== 'standard') return { destination, blocked: null }
  if (!destination) return { destination: null, blocked: null }
  if (method === 'instant' && destination.method !== 'instant') return { destination, blocked: 'instant_unavailable' }
  return {
    destination: {
      ...destination,
      method,
      fallbackReason: method === 'standard' ? null : destination.fallbackReason || null,
    },
    blocked: null,
  }
}

export async function cashoutQuote({ sb, stripe, driverId, env = process.env, now = new Date(), method = null }) {
  // A test-mode (or other-platform) account is invisible to the live key: treat it as not set up.
  const usable = await usableConnectAccount(stripe, await loadConnectAccount(sb, driverId), env)
  const account = usable.accountId
  let destination = null
  if (account) destination = payoutDestination(await listDestinations(stripe, account))
  const picked = destinationForMethod(destination, method)
  const trips = await sb.from('trips').select('id, status, metadata')
    .eq('driver_id', driverId).in('status', ['completed', 'cancelled_wait'])
  if (trips.error) throw new Error(trips.error.message)
  const today = account ? await cashedOutToday(sb, driverId, now) : false
  const fee = cashoutFeeConfig(env)
  const balanceCents = cashoutBalanceCents(trips.data)
  if (picked.blocked === 'instant_unavailable') {
    return {
      state: 'instant_unavailable',
      method: 'instant',
      ...cashoutBreakdown(balanceCents, { method: 'instant', ...fee }),
      last4: destination?.last4 || null,
      connectAccountId: account,
    }
  }
  return {
    ...cashoutState({ connectAccountId: account, destination: picked.destination, balanceCents, cashedOutToday: today, ...fee }),
    connectAccountId: account,
    ...(usable.needsReonboard ? { needsReonboard: true } : {}),
  }
}

const CLAIM_ERRORS = ['already_cashed_out_today', 'zero_balance', 'balance_below_fee']

/**
 * Execute after the driver confirmed the quoted fee. expectedFeeCents must
 * match the fee the server would charge now, so a stale confirm can't charge
 * a different fee.
 */
export async function executeCashout({ sb, stripe, driverId, expectedFeeCents, env = process.env, now = new Date(), method: requestedMethod = null }) {
  if (!cashoutKeyAllowed(env.STRIPE_SECRET_KEY, env)) return { ok: false, status: 403, error: 'live_keys_blocked' }
  if (sweepWindowBlocked(now)) return { ok: false, status: 409, error: 'sweep_window' }
  const quote = await cashoutQuote({ sb, stripe, driverId, env, now, method: requestedMethod })
  if (quote.state !== 'ready') return { ok: false, status: 409, error: quote.state, quote }
  if (Number(expectedFeeCents) !== quote.feeCents) return { ok: false, status: 409, error: 'fee_changed', quote }

  const fee = quote.method === 'instant' ? cashoutFeeConfig(env) : { feeBps: 0, feeMinCents: 0 }
  const claim = await sb.rpc('claim_driver_cashout', { p_driver: driverId, p_fee_bps: fee.feeBps, p_fee_min_cents: fee.feeMinCents })
  if (claim.error) {
    const code = CLAIM_ERRORS.find((c) => String(claim.error.message || '').includes(c))
      || (/duplicate key|unique/i.test(claim.error.message || '') ? 'already_cashed_out_today' : null)
    return { ok: false, status: code ? 409 : 500, error: code || claim.error.message }
  }
  const row = Array.isArray(claim.data) ? claim.data[0] : claim.data
  const details = { method: quote.method, fallbackReason: quote.fallbackReason || null, connectAccountId: quote.connectAccountId }
  if (payoutApprovalRequired(env)) {
    // Live: the claim holds the trips (cashout_pending) until the approver decides.
    const gate = await payoutGate({
      sb, env, kind: 'cashout', sourceRef: `cashout:${row.id}`, payeeId: driverId, amountCents: row.net_cents,
      sourceId: row.id, destination: quote.connectAccountId,
      details: { ...details, grossCents: row.gross_cents, feeCents: row.fee_cents },
    })
    if (!gate.allowed) {
      return {
        ok: true, pendingApproval: true, status: 200, cashoutId: row.id, approvalRequestId: gate.request?.id || null,
        approvalStatus: gate.request?.status || 'pending_approval', method: quote.method,
        grossCents: row.gross_cents, feeCents: quote.method === 'instant' ? row.fee_cents : 0, netCents: row.net_cents,
      }
    }
    return runCashoutTransfers({ sb, stripe, row, driverId, ...details, approval: gate.bypass ? null : gate.request })
  }
  return runCashoutTransfers({ sb, stripe, row, driverId, ...details, approval: null })
}

function settleFor(sb, row) {
  return (args) => sb.rpc('settle_driver_cashout', {
    p_cashout: row.id, p_ok: args.ok, p_status: args.status, p_method: args.method || null,
    p_transfer: args.transfer || null, p_payout: args.payout || null,
    p_fallback: args.fallback || null, p_error: args.error || null,
  })
}

/**
 * Transfer to the driver's connected account, then pay it out. Stripe
 * idempotency keys are tied to the cash-out row, so a retry never pays twice.
 */
export async function runCashoutTransfers({ sb, stripe, row, driverId, method: quotedMethod, fallbackReason = null, connectAccountId, approval = null }) {
  const settle = settleFor(sb, row)
  let transfer
  try {
    transfer = await stripe.transfers.create({
      amount: row.net_cents, currency: 'usd', destination: connectAccountId,
      transfer_group: `cashout:${row.id}`,
      metadata: { cashoutId: row.id, driverId, grossCents: String(row.gross_cents), feeCents: String(row.fee_cents), ...(approval ? { approvalRequestId: approval.id } : {}) },
    }, { idempotencyKey: approval ? approvalIdempotencyKey(approval, 'cashout-transfer') : `cashout-transfer:${row.id}` })
  } catch (err) {
    await settle({ ok: false, status: 'failed', error: err?.message || 'transfer_failed' })
    if (approval) await markApprovalFailed(sb, approval, err, { definite: isDefiniteStripeError(err) })
    return { ok: false, status: 502, error: 'transfer_failed', detail: err?.message }
  }

  let method = quotedMethod
  let fallback = fallbackReason || null
  let payoutAmount = row.net_cents
  let payout = null
  let payoutError = null
  try {
    payout = await stripe.payouts.create(
      { amount: payoutAmount, currency: 'usd', method, metadata: { cashoutId: row.id } },
      { stripeAccount: connectAccountId, idempotencyKey: `cashout-payout:${row.id}:${method}` })
  } catch (err) {
    if (method === 'instant' && isInstantIneligibleError(err)) {
      method = 'standard'
      fallback = 'instant_ineligible'
      // No instant fee on a standard payout: send the held fee too.
      if (row.fee_cents > 0) {
        try {
          await stripe.transfers.create({
            amount: row.fee_cents, currency: 'usd', destination: connectAccountId,
            transfer_group: `cashout:${row.id}`, metadata: { cashoutId: row.id, kind: 'fee_return' },
          }, { idempotencyKey: `cashout-fee-return:${row.id}` })
          payoutAmount += row.fee_cents
        } catch (feeErr) { payoutError = feeErr?.message || 'fee_return_failed' }
      }
      try {
        payout = await stripe.payouts.create(
          { amount: payoutAmount, currency: 'usd', method: 'standard', metadata: { cashoutId: row.id } },
          { stripeAccount: connectAccountId, idempotencyKey: `cashout-payout:${row.id}:standard` })
      } catch (err2) { payoutError = err2?.message || 'payout_failed' }
    } else {
      payoutError = err?.message || 'payout_failed'
    }
  }
  // Money already reached the driver's Stripe balance, so trips are paid either way.
  // Without a payout object Stripe's regular schedule pays the balance out.
  const saved = await settle({
    ok: true, status: payout ? 'paid' : 'transferred', method, transfer: transfer.id,
    payout: payout?.id, fallback, error: payoutError,
  })
  if (saved.error) console.error('[cashout] settle', saved.error.message)
  if (approval) await markApprovalSent(sb, approval, { transferId: transfer.id, payoutId: payout?.id || null })
  return {
    ok: true, cashoutId: row.id, method, fallbackReason: fallback,
    grossCents: row.gross_cents, feeCents: method === 'instant' ? row.fee_cents : 0, netCents: payoutAmount,
    transferId: transfer.id, payoutId: payout?.id || null, payoutError,
  }
}

async function loadCashoutRow(sb, cashoutId) {
  const res = await sb.from('driver_cashouts').select('*').eq('id', cashoutId).maybeSingle()
  if (res?.error) throw new Error(res.error.message)
  return res?.data || null
}

/** Run an approved cash-out. Only a still-claimed row moves money. */
export async function completeApprovedCashout({ sb, stripe, request }) {
  const row = await loadCashoutRow(sb, request.source_id)
  if (!row) return { ok: false, status: 404, error: 'cashout_not_found' }
  if (row.status !== 'claimed') return { ok: false, status: 409, error: `cashout_${row.status}` }
  const details = request.details || {}
  const fresh = (await loadApprovalBySource(sb, request.source_ref)) || request
  return runCashoutTransfers({
    sb, stripe, row, driverId: row.driver_id,
    method: details.method || row.method || 'standard',
    fallbackReason: details.fallbackReason || null,
    connectAccountId: details.connectAccountId || request.destination_account,
    approval: fresh,
  })
}

/** Rejected cash-out: release the held trips back to the driver's balance. */
export async function releaseRejectedCashout({ sb, request }) {
  const row = await loadCashoutRow(sb, request.source_id)
  if (!row || row.status !== 'claimed') return { ok: true, skipped: true }
  const reason = request.reject_reason ? `rejected_by_admin: ${request.reject_reason}` : 'rejected_by_admin'
  const res = await settleFor(sb, row)({ ok: false, status: 'failed', error: reason.slice(0, 500) })
  if (res?.error) return { ok: false, error: res.error.message }
  return { ok: true, released: true }
}
