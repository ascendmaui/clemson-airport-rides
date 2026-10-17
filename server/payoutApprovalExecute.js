/**
 * Runs the money movement behind an approved payout request, or applies a
 * rejection. Each source flow is re-run; its payoutGate() call sees the
 * decision, so approved requests send exactly once (approval idempotency key)
 * and rejected ones return to the driver's unpaid balance.
 */
import { completeApprovedCashout, releaseRejectedCashout } from './cashout.js'
import { claimedByCashout } from './endpoints/driverPayouts.js'
import {
  attemptCancelFeePayout, attemptDriverPayout, attemptStandbyBackupPayout, attemptSwitchFeePayout,
  attemptTipPayout, loadConnectAccount, writePayout,
} from './payouts.js'
import { markApprovalSuperseded } from './payoutApproval.js'
import { payBonusLedger } from './perks.js'

const TRIP_COLUMNS = 'id, driver_id, fare_cents, tip_cents, status, driver_wait_earnings_cents, metadata, dropoff_label'

async function loadTrip(sb, tripId) {
  const res = await sb.from('trips').select(TRIP_COLUMNS).eq('id', tripId).maybeSingle()
  if (res?.error) throw new Error(res.error.message)
  return res?.data || null
}

function summarize(result) {
  if (!result) return { ok: false, error: 'no_result' }
  const payout = result.payout || {}
  return {
    ok: result.ok === true,
    status: payout.status || result.status || null,
    transferId: payout.stripeTransferId || result.transferId || null,
    payoutId: result.payoutId || null,
    error: result.error || payout.lastError || null,
    needsReonboard: result.needsReonboard === true || undefined,
  }
}

/** Re-run the flow that created the request. */
export async function rerunApprovalSource({ sb, stripe, request, env = process.env }) {
  const kind = request.kind
  if (kind === 'cashout') {
    if (request.status === 'rejected') return releaseRejectedCashout({ sb, request })
    return summarize(await completeApprovedCashout({ sb, stripe, request, env }))
  }
  if (kind === 'bonus') {
    const rows = await payBonusLedger(sb, stripe, { ids: [request.source_id], env, limit: 1 })
    const row = rows?.[0]
    return { ok: row?.ok === true, status: row?.status || null, error: row?.error || row?.reason || null }
  }
  const tripId = request.trip_id || request.source_id
  const trip = tripId ? await loadTrip(sb, tripId) : null
  if (!trip) return { ok: false, error: 'trip_not_found' }
  if (kind === 'trip_payout' || kind === 'wait_cancel') {
    if (await claimedByCashout(sb, trip.id)) {
      await markApprovalSuperseded(sb, request, 'claimed_by_cashout')
      return { ok: true, superseded: true }
    }
    const account = await loadConnectAccount(sb, trip.driver_id)
    const attempt = await attemptDriverPayout({ trip, stripe, connectAccountId: account, sb, env })
    await writePayout(sb, trip, attempt.payout)
    return summarize(attempt)
  }
  const role = {
    tip: attemptTipPayout,
    standby: attemptStandbyBackupPayout,
    cancel_fee: attemptCancelFeePayout,
    switch_fee: attemptSwitchFeePayout,
  }[kind]
  if (!role) return { ok: false, error: 'unsupported_kind' }
  return summarize(await role({ sb, trip, stripe, env }))
}
