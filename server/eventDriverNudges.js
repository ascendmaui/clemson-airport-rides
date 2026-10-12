import { nudgeDue, nudgeCopy } from '../shared/campusEvents.js'
import { approvedDriverIds, pushDrivers } from './driverBroadcastPush.js'

export const EVENT_COLUMNS = 'id, kind, title, event_date, ends_on, starts_at, active, nudge_lead_hours, nudge_sent_at, driver_bonus_cents, bonus_starts_at, bonus_ends_at'

/**
 * trip-sweeps: send one pre-event supply nudge per clemson_events row.
 * The row is claimed (nudge_sent_at set where null) before any push so a
 * second tick cannot double send. Drivers only; riders get nothing.
 */
export async function sweepEventDriverNudges(sb, { now = new Date(), dryRun = false, push = pushDrivers, drivers = approvedDriverIds } = {}) {
  const at = new Date(now)
  const result = { released: 0, canceled: 0, charged: 0, failed: 0, skipped: 0, sent: 0, ids: { released: [], canceled: [], charged: [], failed: [], skipped: [] } }
  const from = new Date(at.getTime() - 86400000).toISOString().slice(0, 10)
  const to = new Date(at.getTime() + 8 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await sb.from('clemson_events').select(EVENT_COLUMNS)
    .eq('active', true).is('nudge_sent_at', null).gte('event_date', from).lte('event_date', to).limit(20)
  if (error) {
    // Columns land with 20261012140000_clemson_events_supply.sql; skip quietly before it.
    if (/nudge_sent_at|nudge_lead_hours|does not exist/i.test(error.message || '')) return { ...result, skipped: 1 }
    throw new Error(error.message || 'Could not load events')
  }
  const due = (data || []).filter((e) => nudgeDue(e, at))
  if (!due.length || dryRun) { result.skipped += due.length; return result }
  let ids = null
  for (const event of due) {
    const claim = await sb.from('clemson_events').update({ nudge_sent_at: at.toISOString() })
      .eq('id', event.id).is('nudge_sent_at', null).select('id')
    if (claim.error || !claim.data?.length) { result.skipped += 1; result.ids.skipped.push(event.id); continue }
    try {
      ids = ids || await drivers(sb)
      const copy = nudgeCopy(event)
      const out = await push(sb, ids, { ...copy, data: { type: 'campus_event', eventId: event.id } })
      result.sent += out.sent
      result.released += 1
      result.ids.released.push(event.id)
    } catch (err) {
      result.failed += 1
      result.ids.failed.push(event.id)
      console.error('[event-driver-nudges]', event.id, err?.message || err)
    }
  }
  return result
}
