/**
 * Persist a filled ride-tier carpool: one trip, a seat hold per rider, and
 * the driver notice. The notice is an in-app record on the trip and a remote
 * Expo push, the same sender ride offers use, so a closed or backgrounded
 * driver app still gets the system toast. Missing queue tables are a no-op.
 */
import { planCarpoolFill } from '../shared/carpoolSeatMatch.js'
import { readDriverPushToken } from './driverPushToken.js'
import { sendExpoPush } from './expoPush.js'
import { insertDriverNotification } from './driverNotifications.js'
import { noteExpoPushResult } from './expoPushReceipts.js'

function queueMissing(error) {
  const message = String(error?.message || error || '')
  return error?.code === '42P01' || error?.code === 'PGRST205' || /carpool_requests|schema cache|relation/i.test(message)
}

function asRequest(row) {
  return {
    id: row.id,
    riderId: row.rider_id,
    pickup: row.pickup,
    dropoff: row.dropoff,
    departAt: row.depart_at,
    tripId: row.trip_id,
    driverId: row.driver_id,
    vehicleId: row.vehicle_id,
  }
}

export async function enrollCarpoolSeat(sb, input = {}, deps = {}) {
  if (!sb?.from || !input.riderId) return { booked: false, reason: 'no_client' }
  const perSeat = Math.max(0, Math.round(Number(input.perSeatFareCents) || 0))
  const departAt = input.departAt instanceof Date
    ? input.departAt.toISOString()
    : (input.departAt || new Date().toISOString())
  let inserted
  try {
    inserted = await sb.from('carpool_requests').insert({
      rider_id: input.riderId,
      pickup: input.pickup,
      dropoff: input.dropoff,
      depart_at: departAt,
      status: 'open',
      party_type: 'carpool',
      trip_id: input.tripId || null,
      seat_fare_cents: perSeat,
      hold_cents: 0,
    }).select('*').single()
  } catch (error) {
    return { booked: false, reason: queueMissing(error) ? 'queue_unavailable' : (error?.message || 'queue_unavailable') }
  }
  if (inserted?.error || !inserted?.data) {
    return { booked: false, reason: queueMissing(inserted?.error) ? 'queue_unavailable' : (inserted?.error?.message || 'queue_unavailable') }
  }

  let open
  try {
    open = await sb.from('carpool_requests').select('*').eq('status', 'open')
  } catch (error) {
    return { booked: false, reason: 'queue_unavailable' }
  }
  if (open?.error) return { booked: false, reason: queueMissing(open.error) ? 'queue_unavailable' : open.error.message }
  const plan = planCarpoolFill((open.data || []).map(asRequest), {
    perSeatFareCents: perSeat,
    drivers: input.drivers,
    tripId: input.tripId || null,
  })
  if (!plan.booked) return plan

  const anchorId = plan.trip.id
  if (anchorId) {
    const patch = {
      tier: 'carpool',
      status: 'searching',
      passengers: plan.trip.passengers,
      fare_cents: plan.trip.fare_cents,
      deposit_cents: 0,
      metadata: plan.trip.metadata,
    }
    try {
      await sb.from('trips').update(patch).eq('id', anchorId)
    } catch {
      // The quote still stands if the trip row cannot take the merge patch.
    }
  }
  const cancelIds = (plan.trip.metadata.merged_trip_ids || []).filter((id) => id && id !== anchorId)
  if (cancelIds.length) {
    try {
      await sb.from('trips').update({
        status: 'canceled',
        metadata: { merged_into: anchorId, kind: 'carpool_seat' },
      }).in('id', cancelIds)
    } catch {
      // A leftover searching row is reconciled by the queue status below.
    }
  }
  for (const hold of plan.holds) {
    try {
      await sb.from('carpool_requests').update({
        status: 'matched',
        trip_id: anchorId,
        seat_fare_cents: hold.estimatedFareCents,
        hold_cents: hold.authorizationCents,
      }).eq('rider_id', hold.riderId).eq('status', 'open')
    } catch {
      // Hold amounts remain on the merged trip metadata.
    }
  }

  let token = null
  if (plan.driverId) {
    try {
      const push = await readDriverPushToken(sb, plan.driverId)
      token = push?.token || null
    } catch {
      token = null
    }
  }
  const sendPush = deps.sendPush
    || ((message) => sendExpoPush(message, { fetch: deps.fetch, env: deps.env }))
  let sent = null
  if (token) {
    try {
      const data = plan.push.data && typeof plan.push.data === 'object' ? { ...plan.push.data } : {}
      const recorded = await insertDriverNotification(sb, {
        userId: plan.driverId,
        type: data.kind || 'ride_offer',
        title: plan.push.title,
        body: plan.push.body,
        data,
      })
      if (recorded.id) data.notificationId = recorded.id
      sent = await sendPush({
        to: token,
        title: plan.push.title,
        body: plan.push.body,
        sound: 'default',
        channelId: 'ride-requests',
        data,
      })
      await noteExpoPushResult(sb, { push: sent, token, ownerId: plan.driverId, ownerRole: 'driver' })
    } catch (error) {
      sent = { sent: false, reason: error?.message || 'push_failed' }
    }
  }
  return { ...plan, pushSent: sent }
}
