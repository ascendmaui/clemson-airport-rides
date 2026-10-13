import { AUTO_CANCEL_MS } from '../src/lib/waitFee.js'
import { applyTripWait } from './tripWait.js'

export async function sweepWaitAutoCancel(sb, { now = new Date(), dryRun = false, ...deps } = {}) {
  const cutoff = new Date(new Date(now).getTime() - AUTO_CANCEL_MS).toISOString()
  const { data, error } = await sb.from('trips')
    .select('id, driver_id, status, arrived_at')
    .eq('status', 'arrived')
    .lte('arrived_at', cutoff)
    .order('arrived_at', { ascending: true })
    .limit(25)
  if (error) throw new Error(error.message || 'Could not load waiting trips')
  const result = { canceled: 0, failed: 0, skipped: 0, ids: { canceled: [], failed: [], skipped: [] } }
  for (const trip of data || []) {
    let outcome = 'skipped'
    try {
      if (!dryRun) {
        const wait = await (deps.applyTripWait || applyTripWait)(sb, { action: 'tick', tripId: trip.id, actorId: trip.driver_id }, deps)
        outcome = wait.charge?.status === 'failed' || wait.payout?.ok === false ? 'failed'
          : wait.trip?.status === 'cancelled_wait' ? 'canceled' : 'skipped'
      }
    } catch (error) {
      console.error('[wait-auto-cancel]', trip.id, error?.message || error)
      outcome = 'failed'
    }
    result[outcome] += 1
    result.ids[outcome].push(trip.id)
  }
  return result
}
