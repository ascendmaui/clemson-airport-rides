import { releaseOpenFareHold } from './fareAuthorization.js'

export async function sweepCanceledHolds(sb, { now = new Date(), stripe, dryRun = false } = {}) {
  const cutoff = new Date(new Date(now).getTime() - 2 * 60 * 1000).toISOString()
  const { data, error } = await sb.from('trips')
    .select('id, status, canceled_at, metadata')
    .in('status', ['canceled', 'canceled_midride', 'cancelled_wait'])
    .eq('metadata->fare_authorization->>status', 'requires_capture')
    .or(`canceled_at.lt.${cutoff},canceled_at.is.null`)
    .order('canceled_at', { ascending: true, nullsFirst: true })
    .limit(25)
  if (error) throw new Error(error.message || 'Could not load canceled fare holds')

  const result = { released: 0, failed: 0, skipped: 0, ids: { released: [], failed: [], skipped: [] } }
  for (const trip of data || []) {
    let outcome
    try {
      const hold = dryRun ? { skipped: true } : await releaseOpenFareHold({ sb, stripe, trip, reason: 'cancel_sweep' })
      outcome = hold.released ? 'released' : hold.ok === false ? 'failed' : 'skipped'
    } catch (error) {
      console.error('[canceled-hold-sweep]', trip.id, error?.message || error)
      outcome = 'failed'
    }
    result[outcome] += 1
    result.ids[outcome].push(trip.id)
  }
  return result
}
