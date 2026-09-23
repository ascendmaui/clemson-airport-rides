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
import { loadGameDayMultiplier } from './credits.js'
import { resolveSurge, percentOffCents, STUDENT_DISCOUNT_BPS } from '../src/lib/fareRates.js'
import { isClemsonEmail } from '../src/lib/studentDomain.js'

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
  if (route.error) {
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
  const vehMul = vehicleFareMultiplier(vehicle, participants.length)
  const isCarpool = ride.kind === 'carpool' || participants.length >= 2
  const airport = rideTouchesAirport(participants)
  const when = new Date()
  const game = await loadGameDayMultiplier(sb, when)
  const surge = resolveSurge({ at: when, airport, gameDayMultiplier: game.multiplier })
  const baseFare = computeFriendFareCents(route.distanceM, route.durationS, {
    surgeMultiplier: surge.multiplier,
    vehicleMultiplier: vehMul,
    isCarpool,
  })
  const groupFare = baseFare.fareCents
  const weights =
    ride.split_mode === 'by_distance' && route.legs?.length
      ? participants.map((_, i) => {
          const leg = route.legs[Math.min(i, route.legs.length - 1)]
          return leg?.distanceM || 1
        })
      : null
  const shares = splitFares(groupFare, participants, ride.split_mode, weights)
  const studentFlags = await studentFlagsFor(sb, participants)
  let studentDiscountCents = 0
  const fares = shares.map((share, i) => {
    if (!studentFlags[i]) return share
    const off = percentOffCents(share, STUDENT_DISCOUNT_BPS)
    studentDiscountCents += off.discountCents
    return off.amountCents
  })
  const totalFare = fares.reduce((sum, n) => sum + n, 0)
  const fareResult = {
    fareCents: totalFare,
    breakdown: {
      ...(baseFare.breakdown || {}),
      vehicle_multiplier: Number(vehMul) || 1,
      surge_multiplier: surge.multiplier,
      surge_rule: surge.rule?.id || null,
      surge_label: surge.rule?.label || null,
      student_discount_cents: studentDiscountCents,
      student_discount_bps: studentDiscountCents ? STUDENT_DISCOUNT_BPS : 0,
      rider_pays_cents: totalFare,
    },
  }

  const stopMeta = [
    { ...wp.origin, order: 0 },
    ...wp.intermediates.map((s, i) => ({ ...s, order: i + 1 })),
    { ...wp.destination, order: wp.intermediates.length + 1 },
  ]

  const maxSeats = vehicleMaxSeats(vehicle)
  const vehicleLabel = vehicle
    ? `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || null
    : null

  const patch = {
    route_polyline: route.polyline,
    distance_m: route.distanceM,
    duration_s: route.durationS,
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
      distanceM: route.distanceM,
      durationS: route.durationS,
      polyline: route.polyline,
      optimizedOrder: route.optimizedOrder,
    },
    maxParticipants: maxSeats,
    vehicleLabel,
    fareHeuristic: 'UberX GSP card v2026-09-23: $1.19 + $2.65 booking + $1.14/mi + $0.18/min, min $5.90; surge; carpool 15%; student 10%',
    surge,
  }
}

function rideTouchesAirport(participants) {
  const blob = JSON.stringify(participants.map((p) => ({ pickup: p.pickup, dropoff: p.dropoff }))).toLowerCase()
  return /airport|\bgsp\b|\bclt\b|greenville-spartanburg|charlotte douglas/.test(blob)
}

async function studentFlagsFor(sb, participants) {
  const ids = participants.map((p) => p.user_id).filter(Boolean)
  const byId = {}
  if (ids.length) {
    const { data } = await sb
      .from('profiles')
      .select('id, email, student_verified_at')
      .in('id', ids)
    for (const row of data || []) byId[row.id] = row
  }
  return participants.map((p) => {
    const prof = p.user_id ? byId[p.user_id] : null
    return Boolean(prof?.student_verified_at) || isClemsonEmail(prof?.email || p.email)
  })
}
