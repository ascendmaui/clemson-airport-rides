/**
 * POST /api/friend-rides-recompute
 * Routes API + fare split. Graceful error if GOOGLE_MAPS_API_KEY missing.
 */
import {
  admin, cors, json, parseBody, loadRideByToken, buildWaypointList, computeRoutes,
  computeFriendFareCents, splitFares, publicRideSummary, userFromAuth,
} from '../server/friendRideLib.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const token = body.token
  if (!token) return json(res, 400, { error: 'token required' })

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    let { ride, participants } = loaded

    if (body.splitMode === 'even' || body.splitMode === 'by_distance') {
      const user = await userFromAuth(req)
      if (user && user.id === ride.organizer_id) {
        await sb.from('friend_rides').update({ split_mode: body.splitMode }).eq('id', ride.id)
        ride = { ...ride, split_mode: body.splitMode }
      }
    }

    const joined = participants.filter((p) => p.pickup || p.dropoff)
    const wp = buildWaypointList(joined.length ? joined : participants)
    if (wp.error) return json(res, 400, { error: wp.error })

    const route = await computeRoutes(wp.origin, wp.destination, wp.intermediates)
    if (route.error) {
      return json(res, 503, {
        error: route.error,
        code: route.code || 'routes_failed',
        message:
          route.code === 'maps_key_missing'
            ? 'Set GOOGLE_MAPS_API_KEY on Vercel (server Routes key — not the Vite browser key alone).'
            : route.error,
      })
    }

    const totalFare = computeFriendFareCents(route.distanceM, route.durationS)
    const weights =
      ride.split_mode === 'by_distance' && route.legs?.length
        ? participants.map((_, i) => {
            const leg = route.legs[Math.min(i, route.legs.length - 1)]
            return leg?.distanceM || 1
          })
        : null
    const fares = splitFares(totalFare, participants, ride.split_mode, weights)

    const stopMeta = [
      { ...wp.origin, order: 0 },
      ...wp.intermediates.map((s, i) => ({ ...s, order: i + 1 })),
      { ...wp.destination, order: wp.intermediates.length + 1 },
    ]

    await sb
      .from('friend_rides')
      .update({
        route_polyline: route.polyline,
        distance_m: route.distanceM,
        duration_s: route.durationS,
        total_fare_cents: totalFare,
        stops: stopMeta,
        status: ride.status === 'draft' ? 'collecting' : ride.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ride.id)

    for (let i = 0; i < participants.length; i++) {
      if (participants[i].status === 'paid') continue
      await sb
        .from('friend_ride_participants')
        .update({ fare_cents: fares[i], updated_at: new Date().toISOString() })
        .eq('id', participants[i].id)
    }

    const reloaded = await loadRideByToken(sb, token)
    return json(res, 200, {
      ...publicRideSummary(reloaded.ride, reloaded.participants),
      route: {
        distanceM: route.distanceM,
        durationS: route.durationS,
        polyline: route.polyline,
        optimizedOrder: route.optimizedOrder,
      },
      fareHeuristic: 'base $2.50 + $1.75/mi + $0.35/min, min $8 (Clemson MVP)',
    })
  } catch (e) {
    console.error('[friend-rides-recompute]', e)
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
