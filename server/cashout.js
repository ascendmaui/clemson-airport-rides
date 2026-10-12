/**
 * Instant cash-out. Claim (DB, one per NY day) -> transfer -> payout.
 * The claim moves trip payouts to cashout_pending so the daily sweep skips
 * them; settle marks them paid or returns them to pending.
 */
import {
  DEFAULT_INSTANT_FEE_BPS, DEFAULT_INSTANT_FEE_MIN_CENTS, cashoutBalanceCents,
  cashoutKeyAllowed, cashoutState, sweepWindowBlocked, isInstantIneligibleError, nyDay, payoutDestination,
} from '../shared/cashout.js'
import { loadConnectAccount } from './payouts.js'

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

export async function cashoutQuote({ sb, stripe, driverId, env = process.env, now = new Date() }) {
  const account = await loadConnectAccount(sb, driverId)
  let destination = null
  if (account) destination = payoutDestination(await listDestinations(stripe, account))
  const trips = await sb.from('trips').select('id, status, metadata')
    .eq('driver_id', driverId).in('status', ['completed', 'cancelled_wait'])
  if (trips.error) throw new Error(trips.error.message)
  const today = account ? await cashedOutToday(sb, driverId, now) : false
  const fee = cashoutFeeConfig(env)
  return {
    ...cashoutState({ connectAccountId: account, destination, balanceCents: cashoutBalanceCents(trips.data), cashedOutToday: today, ...fee }),
    connectAccountId: account,
  }
}

const CLAIM_ERRORS = ['already_cashed_out_today', 'zero_balance', 'balance_below_fee']

/**
 * Execute after the driver confirmed the quoted fee. expectedFeeCents must
 * match the fee the server would charge now, so a stale confirm can't charge
 * a different fee.
 */
export async function executeCashout({ sb, stripe, driverId, expectedFeeCents, env = process.env, now = new Date() }) {
  if (!cashoutKeyAllowed(env.STRIPE_SECRET_KEY, env)) return { ok: false, status: 403, error: 'live_keys_blocked' }
  if (sweepWindowBlocked(now)) return { ok: false, status: 409, error: 'sweep_window' }
  const quote = await cashoutQuote({ sb, stripe, driverId, env, now })
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
  const settle = (args) => sb.rpc('settle_driver_cashout', {
    p_cashout: row.id, p_ok: args.ok, p_status: args.status, p_method: args.method || null,
    p_transfer: args.transfer || null, p_payout: args.payout || null,
    p_fallback: args.fallback || null, p_error: args.error || null,
  })

  let transfer
  try {
    transfer = await stripe.transfers.create({
      amount: row.net_cents, currency: 'usd', destination: quote.connectAccountId,
      transfer_group: `cashout:${row.id}`,
      metadata: { cashoutId: row.id, driverId, grossCents: String(row.gross_cents), feeCents: String(row.fee_cents) },
    }, { idempotencyKey: `cashout-transfer:${row.id}` })
  } catch (err) {
    await settle({ ok: false, status: 'failed', error: err?.message || 'transfer_failed' })
    return { ok: false, status: 502, error: 'transfer_failed', detail: err?.message }
  }

  let method = quote.method
  let fallback = quote.fallbackReason || null
  let payoutAmount = row.net_cents
  let payout = null
  let payoutError = null
  try {
    payout = await stripe.payouts.create(
      { amount: payoutAmount, currency: 'usd', method, metadata: { cashoutId: row.id } },
      { stripeAccount: quote.connectAccountId, idempotencyKey: `cashout-payout:${row.id}:${method}` })
  } catch (err) {
    if (method === 'instant' && isInstantIneligibleError(err)) {
      method = 'standard'
      fallback = 'instant_ineligible'
      // No instant fee on a standard payout: send the held fee too.
      if (row.fee_cents > 0) {
        try {
          await stripe.transfers.create({
            amount: row.fee_cents, currency: 'usd', destination: quote.connectAccountId,
            transfer_group: `cashout:${row.id}`, metadata: { cashoutId: row.id, kind: 'fee_return' },
          }, { idempotencyKey: `cashout-fee-return:${row.id}` })
          payoutAmount += row.fee_cents
        } catch (feeErr) { payoutError = feeErr?.message || 'fee_return_failed' }
      }
      try {
        payout = await stripe.payouts.create(
          { amount: payoutAmount, currency: 'usd', method: 'standard', metadata: { cashoutId: row.id } },
          { stripeAccount: quote.connectAccountId, idempotencyKey: `cashout-payout:${row.id}:standard` })
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
  return {
    ok: true, cashoutId: row.id, method, fallbackReason: fallback,
    grossCents: row.gross_cents, feeCents: method === 'instant' ? row.fee_cents : 0, netCents: payoutAmount,
    transferId: transfer.id, payoutId: payout?.id || null, payoutError,
  }
}
