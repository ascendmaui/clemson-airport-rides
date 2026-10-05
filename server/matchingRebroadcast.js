import { listAssignableDrivers } from './autoAssign.js'
import { notifyDriverOffer } from './driverOfferAlerts.js'
import { unchangedOfferQuery } from '../shared/driverOrder.js'
import { isPoolPhase, netCentsForShare, poolDeadlineIso, poolOfferPatch, POOL_SHARE_BPS } from '../packages/rides-native/offerLadder.js'

/** Advance missed offers without relying on either app staying open. */
export async function rebroadcastMissedOffers(sb, {
  now = new Date(),
  limit = 100,
  dryRun = false,
  alertDriver = notifyDriverOffer,
} = {}) {
  const at = now.toISOString()
  const due = await sb.from('trips')
    .select('id, rider_id, driver_id, status, tier, metadata, deposit_cents, fare_cents, pickup_at, scheduled_for, offer_expires_at, pickup_label, dropoff_label')
    .in('status', ['searching', 'offered']).is('driver_id', null)
    .lte('offer_expires_at', at)
    .order('offer_expires_at', { ascending: true }).order('id', { ascending: true })
    .limit(limit)
  if (due.error) throw new Error(due.error.message)
  const result = {
    scanned: due.data?.length || 0,
    advanced: 0,
    released: 0,
    pooled: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
    wouldAdvance: 0,
    wouldPool: 0,
    wouldExpire: 0,
    dryRun,
  }
  for (const trip of due.data || []) {
    const meta = trip.metadata || {}
    const pool = isPoolPhase(trip)
    if (meta.kind !== 'driver_request' || (!meta.offer_driver_id && !pool) || Number(trip.deposit_cents || 0) !== 0
        || trip.pickup_at || trip.scheduled_for) {
      result.skipped++
      continue
    }
    try {
      const eligible = await listAssignableDrivers(sb, { tier: trip.tier || 'standard', riderId: trip.rider_id })
      if (eligible.error) throw new Error(eligible.error)
      const passes = await sb.from('driver_offer_passes').select('driver_id').eq('trip_id', trip.id)
      if (passes.error) throw new Error(passes.error.message)
      const passed = new Set((passes.data || []).map((row) => row.driver_id))
      if (dryRun) {
        if (isPoolPhase(trip)) result.wouldExpire++
        else {
          result.wouldPool++
          result.wouldAdvance++
        }
        continue
      }
      if (isPoolPhase(trip)) {
        const updated = await unchangedOfferQuery(sb.from('trips').update({
          status: 'canceled',
          canceled_at: at,
          offer_expires_at: null,
          metadata: {
            ...meta,
            offer_phase: 'expired',
            cancel_reason: 'offer_expired',
            offer_expired_at: at,
          },
        }), trip)
          .eq('id', trip.id).is('driver_id', null).in('status', ['searching', 'offered'])
          .eq('offer_expires_at', trip.offer_expires_at)
          .select('id').maybeSingle()
        if (updated.error) throw new Error(updated.error.message)
        if (!updated.data) result.skipped++
        else result.expired++
        continue
      }
      const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
      const poolNet = fare ? netCentsForShare(fare, POOL_SHARE_BPS) : null
      const updated = await unchangedOfferQuery(sb.from('trips').update({
        status: 'searching',
        offer_expires_at: poolDeadlineIso(now),
        ...(poolNet != null ? { driver_earnings_cents: poolNet, platform_fee_cents: fare - poolNet } : {}),
        metadata: {
          ...meta,
          ...poolOfferPatch(now),
          offer_tried_driver_ids: [
            ...(Array.isArray(meta.offer_tried_driver_ids) ? meta.offer_tried_driver_ids : []),
            meta.offer_driver_id,
          ].filter(Boolean),
          offer_rebroadcast_at: at,
          offer_rebroadcast_reason: 'exclusive_window_elapsed',
          preserved: meta.preserved,
        },
      }), trip)
        .eq('id', trip.id).is('driver_id', null).in('status', ['searching', 'offered'])
        .eq('offer_expires_at', trip.offer_expires_at)
        .select('id').maybeSingle()
      if (updated.error) throw new Error(updated.error.message)
      if (!updated.data) {
        result.skipped++ // accept, cancel, pass, or another sweep won
        continue
      }
      result.pooled++
      result.released++
      result.advanced++
      const listeners = (eligible.drivers || []).filter((driver) => driver.id && driver.id !== trip.rider_id && !passed.has(driver.id))
      for (const driver of listeners) {
        try {
          await alertDriver(sb, {
            trip: { ...trip, pickup_label: trip.pickup_label, dropoff_label: trip.dropoff_label, tier: trip.tier },
            driverId: driver.id,
            offerMarker: `pool:${at}`,
          })
        } catch (alertError) {
          console.error('[driver-offer-alert]', trip.id, alertError?.message || alertError)
        }
      }
    } catch (error) {
      result.errors++
      console.error('[matching-rebroadcast]', trip.id, error.message)
    }
  }
  return result
}
