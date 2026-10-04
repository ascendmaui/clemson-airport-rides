import { unchangedOfferQuery } from '../shared/driverOrder.js'
import { listAssignableDrivers } from './autoAssign.js'
import { notifyDriverOffer } from './driverOfferAlerts.js'
import { ACTIONABLE_LEAD_MS } from '../src/lib/scheduledRideModel.js'

/** Reuse live dispatch unchanged. Preserve the reservation time in metadata. */
export async function releaseScheduledRides(sb, {
  now = new Date(), dryRun = false, limit = 100, alertDriver = notifyDriverOffer,
} = {}) {
  const due = await sb.from('trips').select('*')
    .eq('status', 'scheduled').is('driver_id', null).eq('deposit_cents', 0)
    .lte('pickup_at', new Date(now.getTime() + ACTIONABLE_LEAD_MS).toISOString())
    .order('pickup_at', { ascending: true }).limit(limit)
  if (due.error) throw new Error(due.error.message)
  const result = { released: 0, skipped: 0, errors: 0, wouldRelease: 0 }
  for (const trip of due.data || []) {
    try {
      const eligible = await listAssignableDrivers(sb, { tier: trip.tier })
      if (eligible.error) throw new Error(eligible.error)
      const queue = eligible.drivers.map(d => d.id).filter(id => id !== trip.rider_id)
      if (dryRun) { result.wouldRelease++; continue }
      const expired = new Date(trip.pickup_at).getTime() < now.getTime() - 20 * 60_000
      const metadata = {
        ...trip.metadata,
        scheduled_pickup_at: trip.pickup_at,
        scheduled_released_at: now.toISOString(),
        kind: 'driver_request',
        offer_driver_id: expired ? null : queue[0] || null,
        auto_assign_queue: queue,
        match: queue.length ? 'auto' : 'open',
      }
      // Compare-and-set: cancellation, early acceptance, and concurrent sweeps win safely.
      const updated = await unchangedOfferQuery(sb.from('trips').update({
        status: expired ? 'canceled' : 'searching',
        ...(expired ? { canceled_at: now.toISOString() } : {}),
        pickup_at: null, scheduled_for: null, metadata,
      }), trip).eq('id', trip.id).eq('status', 'scheduled').is('driver_id', null)
        .eq('pickup_at', trip.pickup_at).eq('deposit_cents', 0)
        .select('id').maybeSingle()
      if (updated.error) throw new Error(updated.error.message)
      if (!updated.data) { result.skipped++; continue }
      result.released++
      if (!expired && queue[0]) {
        try {
          await alertDriver(sb, { trip, driverId: queue[0], offerMarker: 'scheduled-release' })
        } catch (error) { console.error('[scheduled-offer-alert]', trip.id, error.message) }
      }
    } catch (error) {
      result.errors++
      console.error('[scheduled-release]', trip.id, error.message)
    }
  }
  return result
}
