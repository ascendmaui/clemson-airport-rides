/**
 * Cancel unassigned offered trips that are no longer a Live offer.
 * The matching-rebroadcast cron calls this after it advances targeted windows.
 * Clients also drop these rows when they read the open pool.
 */
import { isUnpaidAirportDepositTrip } from '../packages/rides-native/tripTags.js'
import { unchangedOfferQuery } from '../shared/driverOrder.js'
import {
  STALE_LIVE_OFFER_TTL_MS,
  futureSchedule,
  isStaleLiveOffer,
  paymentHoldBlocksCancel,
  rebroadcastOwnsOffer,
} from '../shared/staleLiveOffer.js'

export { STALE_LIVE_OFFER_TTL_MS, isStaleLiveOffer }

export function shouldExpireStaleLiveOffer(trip, now = Date.now(), ttlMs = STALE_LIVE_OFFER_TTL_MS) {
  if (!isStaleLiveOffer(trip, now, ttlMs)) return false
  if (rebroadcastOwnsOffer(trip)) return false
  if (futureSchedule(trip, now)) return false
  if (paymentHoldBlocksCancel(trip)) return false
  if (isUnpaidAirportDepositTrip(trip)) return false
  return true
}

function metaOf(trip) {
  return trip?.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
    ? trip.metadata
    : {}
}

export async function expireStaleLiveOffers(sb, {
  now = new Date(),
  limit = 100,
  dryRun = false,
  ttlMs = STALE_LIVE_OFFER_TTL_MS,
} = {}) {
  const atDate = now instanceof Date ? now : new Date(now)
  const at = Number.isFinite(atDate.getTime()) ? atDate.toISOString() : new Date().toISOString()
  const listed = await sb.from('trips')
    .select('id, status, driver_id, created_at, requested_at, offer_expires_at, pickup_at, scheduled_for, deposit_cents, rider_note, metadata')
    .eq('status', 'offered')
    .is('driver_id', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (listed.error) throw new Error(listed.error.message)
  const result = {
    scanned: listed.data?.length || 0,
    expired: 0,
    skipped: 0,
    errors: 0,
    wouldExpire: 0,
    dryRun,
  }
  for (const trip of listed.data || []) {
    if (!shouldExpireStaleLiveOffer(trip, atDate, ttlMs)) {
      result.skipped++
      continue
    }
    if (dryRun) {
      result.wouldExpire++
      continue
    }
    try {
      const meta = metaOf(trip)
      const updated = await unchangedOfferQuery(sb.from('trips').update({
        status: 'canceled',
        canceled_at: at,
        metadata: {
          ...meta,
          offer_expired_at: at,
          offer_expired_reason: 'stale_live_offer',
        },
      }), trip)
        .eq('id', trip.id)
        .eq('status', 'offered')
        .is('driver_id', null)
        .select('id')
        .maybeSingle()
      if (updated.error) throw new Error(updated.error.message)
      if (!updated.data) {
        result.skipped++
        continue
      }
      result.expired++
      const event = await sb.from('trip_events').insert({
        trip_id: trip.id,
        kind: 'canceled',
        payload: { reason: 'stale_live_offer', from: 'offered', source: 'offer_ttl' },
      })
      if (event.error) console.error('[stale-live-offer]', trip.id, event.error.message)
    } catch (error) {
      result.errors++
      console.error('[stale-live-offer]', trip.id, error.message)
    }
  }
  return result
}
