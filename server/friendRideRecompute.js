/**
 * Shared route + fare recompute for friend rides.
 * Used by /api/friend-rides-recompute and auto-run before confirm-charges.
 */
import {
  loadRideByToken, buildWaypointList, computeRoutes, computeFriendFareCents, splitFares,
} from './friendRideLib.js'
import {
  loadDriverVehicle, vehicleMaxSeats, vehicleFareMultiplier,
} from './friendRideCapacity.js'
import { quoteCarpool, carpoolSeatCap } from '../src/lib/carpoolEngine.js'
import { eligibleFirstRideIds, gameDayActive } from './carpoolSettle.js'

function preserveRideMeta(ride, breakdown) {
  const prev = ride?.fare_breakdown || {}
  return {
    ...breakdown,
    match_mode: prev.match_mode || null,
    party_type: prev.party_type || null,
    ambassador_code: prev.ambassador_code || null,
  }
}

export async function recomputeRideFares(sb, token, { splitMode } = {}) {
  const loaded = await loadRideByToken(sb, token)
  if (!loaded) return { ok: false, error: 'Friend ride not found', code: 'not_found' }
  let { ride, participants } = loaded

  if (splitMode === 'even' || splitMode === 'by_distance') {
    await sb.from('friend_rides').update({ split_mode: splitMode }).eq('id', ride.id)
    ride = { ...ride, split_mode: splitMode }
  }

  const joined = participants.filter((p) => p.pickup || p.dropoff)
  const wp = buildWaypointList(joined.length ? joined : participants)
  if (wp.error) return { ok: false, error: wp.error, code: 'waypoints' }

  const route = await computeRoutes(wp.origin, wp.destination, wp.intermediates)
  const isCarpool = ride.kind === 'carpool'
  if (route.error && !isCarpool) {
    return {
      ok: false,
      error: route.error,
      code: route.code || 'routes_failed',
      message:
        route.code === 'maps_key_missing'
          ? 'Set GOOGLE_MAPS_API_KEY on Vercel (server Routes key — not the Vite browser key alone).'
          : route.error,
    }
  }

  const driverId = ride.driver_profile_id || ride.organizer_id
  const vehicle = await loadDriverVehicle(sb, driverId)
  const routed = !route.error
  let totalFare
  let fareResult
  let fares

  if (isCarpool) {
    const now = new Date()
    const gameDay = await gameDayActive(sb, now)
    const freeIds = await eligibleFirstRideIds(sb, participants, now, { gameDay })
    const quote = quoteCarpool({
      riders: participants.map((p) => ({
        id: p.id,
        userId: p.user_id,
        displayName: p.display_name,
        pickup: p.pickup || wp.origin,
        dropoff: p.dropoff || wp.destination,
        departAt: ride.created_at || now,
      })),
      at: now,
      gameDay,
      distanceM: routed ? route.distanceM : null,
      durationS: routed ? route.durationS : null,
      firstRideFreeIds: freeIds,
    })
    totalFare = quote.grossCents
    fareResult = {
      fareCents: totalFare,
      breakdown: preserveRideMeta(ride, {
        carpool: quote,
        vehicle_multiplier: 1,
        route_estimated: !routed,
      }),
    }
    const byId = new Map(quote.shares.map((share) => [share.id, share.shareCents]))
    fares = participants.map((p) => byId.get(p.id) ?? 0)
  } else {
    const vehMul = vehicleFareMultiplier(vehicle, participants.length)
    // Apply vehicle/party multiplier here so fares are correct even if
    // computeFriendFareCents ignores vehicleMultiplier (pre-lib-patch tip).
    const baseFare = computeFriendFareCents(route.distanceM, route.durationS)
    totalFare = Math.round((baseFare.fareCents || 0) * (Number(vehMul) || 1))
    fareResult = {
      fareCents: totalFare,
      breakdown: preserveRideMeta(ride, {
        ...(baseFare.breakdown || {}),
        vehicle_multiplier: Number(vehMul) || 1,
      }),
    }
    const weights =
      ride.split_mode === 'by_distance' && route.legs?.length
        ? participants.map((_, i) => {
            const leg = route.legs[Math.min(i, route.legs.length - 1)]
            return leg?.distanceM || 1
          })
        : null
    fares = splitFares(totalFare, participants, ride.split_mode, weights)
  }

  const stopMeta = [
    { ...wp.origin, order: 0 },
    ...wp.intermediates.map((s, i) => ({ ...s, order: i + 1 })),
    { ...wp.destination, order: wp.intermediates.length + 1 },
  ]

  const vehicleSeats = vehicleMaxSeats(vehicle)
  const maxSeats = isCarpool
    ? carpoolSeatCap({
      kind: 'carpool',
      partyType: ride.fare_breakdown?.party_type,
      matchMode: ride.fare_breakdown?.match_mode,
      vehicleSeats,
    })
    : vehicleSeats
  const vehicleLabel = vehicle
    ? `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || null
    : null
  const safeRoute = routed
    ? route
    : { polyline: null, distanceM: null, durationS: null, optimizedOrder: null }

  const patch = {
    route_polyline: safeRoute.polyline,
    distance_m: safeRoute.distanceM,
    duration_s: safeRoute.durationS,
    total_fare_cents: totalFare,
    fare_breakdown: fareResult.breakdown,
    stops: stopMeta,
    status: ride.status === 'draft' ? 'collecting' : ride.status,
    updated_at: new Date().toISOString(),
  }

  const { error: upErr } = await sb.from('friend_rides').update(patch).eq('id', ride.id)
  if (upErr) return { ok: false, error: upErr.message, code: 'update_failed' }

  await sb
    .from('friend_rides')
    .update({ max_participants: maxSeats, vehicle_label: vehicleLabel })
    .eq('id', ride.id)

  for (let i = 0; i < participants.length; i++) {
    if (participants[i].status === 'paid') continue
    await sb
      .from('friend_ride_participants')
      .update({ fare_cents: fares[i], updated_at: new Date().toISOString() })
      .eq('id', participants[i].id)
  }

  const reloaded = await loadRideByToken(sb, token)
  if (reloaded?.ride) {
    reloaded.ride.max_participants = reloaded.ride.max_participants || maxSeats
    reloaded.ride.vehicle_label = reloaded.ride.vehicle_label || vehicleLabel
  }

  return {
    ok: true,
    ride: reloaded.ride,
    participants: reloaded.participants,
    route: {
      distanceM: safeRoute.distanceM,
      durationS: safeRoute.durationS,
      polyline: safeRoute.polyline,
      optimizedOrder: safeRoute.optimizedOrder,
    },
    maxParticipants: maxSeats,
    vehicleLabel,
    fareHeuristic: isCarpool
      ? 'Carpool: each rider pays a fraction of their solo surge price (35% when 4). Driver nets 80% and at least a solo trip plus driver_carpool_bonus. Platform 20%.'
      : 'base $2.50 + $1.75/mi + $0.35/min × vehicle/party, min $8 (Clemson MVP)',
  }
}
