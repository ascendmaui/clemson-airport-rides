import { chargeWaitFees } from './tripWait.js'
import { enqueueWaitCancelPayout } from './payouts.js'

export async function sweepWaitFeeCharge(sb, { now = new Date(), dryRun = false, ...deps } = {}) {
  const cutoff = new Date(new Date(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  // Filter the embedded relation by kind before the anti-join. A payment of any
  // status blocks this backstop, including pending or failed charges.
  const { data, error } = await sb.from('trips')
    .select('*, payments!left(id)')
    .eq('status', 'cancelled_wait')
    .gte('canceled_at', cutoff)
    .lte('canceled_at', new Date(now).toISOString())
    .in('payments.kind', ['wait_fee', 'cancel_fee'])
    .is('payments', null)
    .order('canceled_at', { ascending: true })
    .limit(10)
  if (error) throw new Error(error.message || 'Could not load uncharged wait cancellations')
  const result = { charged: 0, failed: 0, skipped: 0, ids: { charged: [], failed: [], skipped: [] } }
  for (const trip of data || []) {
    let outcome = 'skipped'
    try {
      if (!dryRun) {
        // Recheck immediately before charging in case a client tick won the race.
        const prior = await sb.from('payments').select('id').eq('trip_id', trip.id).in('kind', ['wait_fee', 'cancel_fee']).limit(1)
        if (prior.error) throw new Error(prior.error.message)
        if (!prior.data?.length) {
          const charge = await (deps.chargeWaitFees || chargeWaitFees)(sb, trip)
          outcome = charge.status === 'succeeded' ? 'charged' : charge.status === 'failed' ? 'failed' : 'skipped'
          if (charge.status === 'succeeded') {
            const payout = await (deps.enqueueWaitCancelPayout || enqueueWaitCancelPayout)({ sb, trip, stripe: deps.stripe })
            if (payout.ok === false) outcome = 'failed'
          }
        }
      }
    } catch (error) {
      console.error('[wait-fee-charge]', trip.id, error?.message || error)
      outcome = 'failed'
    }
    result[outcome] += 1
    result.ids[outcome].push(trip.id)
  }
  return result
}
