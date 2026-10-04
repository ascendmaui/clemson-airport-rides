import { listAssignableDrivers } from './autoAssign.js'
import { unchangedOfferQuery } from '../shared/driverOrder.js'

/** Advance missed offers without relying on either app staying open. */
export async function rebroadcastMissedOffers(sb, { now = new Date(), limit = 100, dryRun = false } = {}) {
  const at = now.toISOString()
  const due = await sb.from('trips')
    .select('id, rider_id, driver_id, status, tier, metadata, deposit_cents, pickup_at, scheduled_for, offer_expires_at')
    .in('status', ['searching', 'offered']).is('driver_id', null)
    .lte('offer_expires_at', at)
    .order('offer_expires_at', { ascending: true }).order('id', { ascending: true })
    .limit(limit)
  if (due.error) throw new Error(due.error.message)
  const result = { scanned: due.data?.length || 0, advanced: 0, released: 0, skipped: 0, errors: 0, wouldAdvance: 0, dryRun }
  for (const trip of due.data || []) {
    const meta = trip.metadata || {}
    if (meta.kind !== 'driver_request' || !meta.offer_driver_id || Number(trip.deposit_cents || 0) !== 0
        || trip.pickup_at || trip.scheduled_for) {
      result.skipped++
      continue
    }
    try {
      const eligible = await listAssignableDrivers(sb, { tier: trip.tier === 'tesla' ? 'tesla' : 'standard' })
      if (eligible.error) throw new Error(eligible.error)
      const passes = await sb.from('driver_offer_passes').select('driver_id').eq('trip_id', trip.id)
      if (passes.error) throw new Error(passes.error.message)
      const tried = new Set([
        ...(Array.isArray(meta.offer_tried_driver_ids) ? meta.offer_tried_driver_ids : []),
        meta.offer_driver_id,
        ...(passes.data || []).map((row) => row.driver_id),
      ])
      const queue = Array.isArray(meta.auto_assign_queue) ? meta.auto_assign_queue : []
      // Keep the original priority order; include drivers who came online later.
      const candidates = new Set(eligible.drivers.map((driver) => driver.id))
      const next = [...queue, ...candidates].find((id) => candidates.has(id) && !tried.has(id) && id !== trip.rider_id) || null
      if (dryRun) {
        result.wouldAdvance++
        continue
      }
      const updated = await unchangedOfferQuery(sb.from('trips').update({
        status: 'searching',
        metadata: {
          ...meta,
          offer_driver_id: next,
          offer_tried_driver_ids: [...tried],
          offer_rebroadcast_at: at,
          offer_rebroadcast_reason: 'no_accept_timeout',
          match: next ? 'auto' : 'open',
        },
      }), trip)
        .eq('id', trip.id).is('driver_id', null).in('status', ['searching', 'offered'])
        .eq('offer_expires_at', trip.offer_expires_at)
        .select('id').maybeSingle()
      if (updated.error) throw new Error(updated.error.message)
      if (!updated.data) result.skipped++ // accept, cancel, pass, or another sweep won
      else if (next) result.advanced++
      else result.released++
    } catch (error) {
      result.errors++
      console.error('[matching-rebroadcast]', trip.id, error.message)
    }
  }
  return result
}
