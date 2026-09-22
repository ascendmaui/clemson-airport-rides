/** Booking + bills + paid markers for friend rides. */
import { buildWaypointList } from './friendRideCore.js'

export async function writeRideBills(sb, { ride, participants, tripId, fareBreakdown, paymentMethodByParticipant }) {
  const rows = []
  const total = ride.total_fare_cents || 0
  const bd = fareBreakdown || {}
  for (const p of participants || []) {
    const share = p.fare_cents || 0
    const ratio = total > 0 ? share / total : 0
    const base = Math.round((bd.base_cents || 0) * ratio)
    const dist = Math.round((bd.distance_cents || 0) * ratio)
    const time = Math.round((bd.time_cents || 0) * ratio)
    const sub = Math.round((bd.subtotal_cents || total) * ratio)
    const surge = Math.max(0, Math.round(sub * ((bd.surge_multiplier || 1) - 1)))
    rows.push({
      trip_id: tripId || null,
      friend_ride_id: ride.id,
      participant_id: p.id,
      participant_profile_id: p.user_id || null,
      display_name: p.display_name,
      email: p.email,
      currency: 'usd',
      base_cents: base,
      distance_cents: dist,
      time_cents: time,
      surge_cents: surge,
      surge_multiplier: bd.surge_multiplier || 1,
      subtotal_cents: sub,
      split_cents: share,
      total_fare_cents: total,
      split_mode: ride.split_mode,
      payment_method: (paymentMethodByParticipant || {})[p.id] || (p.stripe_payment_intent_id ? 'card_on_file' : 'payment_element'),
      stripe_payment_intent_id: p.stripe_payment_intent_id,
      distance_m: ride.distance_m,
      duration_s: ride.duration_s,
      line_items: [
        { label: 'Base', cents: base },
        { label: 'Distance', cents: dist },
        { label: 'Time', cents: time },
        { label: 'Surge', cents: surge, multiplier: bd.surge_multiplier || 1 },
        { label: 'Your split', cents: share },
      ],
      charged_at: p.paid_at || new Date().toISOString(),
    })
  }
  if (!rows.length) return { ok: true, count: 0 }
  const { error } = await sb.from('ride_bills').insert(rows)
  if (error) {
    console.error('[writeRideBills]', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, count: rows.length }
}

export async function maybeBookFriendRide(sb, rideId) {
  const { data: ride } = await sb.from('friend_rides').select('*').eq('id', rideId).single()
  if (!ride || ride.trip_id) return { booked: false, reason: 'already_or_missing' }
  const { data: parts } = await sb
    .from('friend_ride_participants')
    .select('*')
    .eq('friend_ride_id', rideId)
  const list = parts || []
  if (!list.length) return { booked: false, reason: 'no_participants' }
  const unpaid = list.filter((p) => p.status !== 'paid')
  if (unpaid.length) return { booked: false, reason: 'awaiting_payment', unpaid: unpaid.length }

  const waypoints = buildWaypointList(list)
  if (waypoints.error) return { booked: false, reason: waypoints.error }

  const origin = waypoints.origin
  const dest = waypoints.destination
  const stopMeta = [
    { ...origin, order: 0 },
    ...waypoints.intermediates.map((s, i) => ({ ...s, order: i + 1 })),
    { ...dest, order: waypoints.intermediates.length + 1 },
  ]

  const { data: trip, error } = await sb
    .from('trips')
    .insert({
      rider_id: ride.organizer_id,
      status: 'searching',
      tier: 'standard',
      pickup_label: origin.label || 'Friend ride pickup',
      dropoff_label: dest.label || 'Friend ride dropoff',
      pickup_lat: origin.lat,
      pickup_lng: origin.lng,
      dropoff_lat: dest.lat,
      dropoff_lng: dest.lng,
      fare_cents: ride.total_fare_cents || 0,
      deposit_cents: ride.total_fare_cents || 0,
      passengers: list.length,
      rider_note: `Friend ride ${ride.token} · ${list.length} riders`,
      stops: stopMeta,
      metadata: {
        kind: 'friend_ride',
        friend_ride_id: ride.id,
        token: ride.token,
        split_mode: ride.split_mode,
        distance_m: ride.distance_m,
        duration_s: ride.duration_s,
        route_polyline: ride.route_polyline,
        participants: list.map((p) => ({
          id: p.id,
          display_name: p.display_name,
          fare_cents: p.fare_cents,
        })),
      },
    })
    .select('id, status')
    .single()

  if (error) return { booked: false, reason: error.message }

  await sb
    .from('friend_rides')
    .update({ status: 'booked', trip_id: trip.id, updated_at: new Date().toISOString() })
    .eq('id', ride.id)

  // Link payments that were trip_id-null to the new trip
  await sb
    .from('payments')
    .update({ trip_id: trip.id })
    .is('trip_id', null)
    .eq('kind', 'friend_ride_share')
    .in(
      'id',
      list.map((p) => p.payment_id).filter(Boolean),
    )

  await writeRideBills(sb, {
    ride,
    participants: list,
    tripId: trip.id,
    fareBreakdown: ride.fare_breakdown || null,
  })

  return { booked: true, trip }
}

export async function markParticipantPaid(sb, participant, paymentIntent) {
  const amount = paymentIntent?.amount || participant.fare_cents || 0
  const piId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id

  let paymentId = participant.payment_id
  if (!paymentId) {
    const riderId = participant.user_id
    if (!riderId) {
      // payments.rider_id is required — use organizer as fallback via join
      const { data: ride } = await sb
        .from('friend_rides')
        .select('organizer_id')
        .eq('id', participant.friend_ride_id)
        .single()
      const { data: pay, error } = await sb
        .from('payments')
        .insert({
          trip_id: null,
          rider_id: riderId || ride?.organizer_id,
          stripe_payment_intent_id: piId,
          kind: 'friend_ride_share',
          amount_cents: amount,
          status: 'succeeded',
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      paymentId = pay.id
    } else {
      const { data: pay, error } = await sb
        .from('payments')
        .insert({
          trip_id: null,
          rider_id: riderId,
          stripe_payment_intent_id: piId,
          kind: 'friend_ride_share',
          amount_cents: amount,
          status: 'succeeded',
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      paymentId = pay.id
    }
  }

  await sb
    .from('friend_ride_participants')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_id: paymentId,
      stripe_payment_intent_id: piId,
      charge_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', participant.id)

  return maybeBookFriendRide(sb, participant.friend_ride_id)
}
