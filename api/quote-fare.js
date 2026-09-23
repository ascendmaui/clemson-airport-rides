/**
 * POST /api/quote-fare
 * Preview a metered fare. Google Routes when coordinates are sent and the
 * server key is set; otherwise the caller can pass miles/minutes or an airport
 * code (Clemson campus → GSP/CLT fallback).
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../server/friendRideLib.js'
import { loadGameDayMultiplier } from '../server/credits.js'
import { isClemsonEmail } from '../src/lib/studentDomain.js'
import {
  quoteFare,
  resolveSurge,
  AIRPORT_ROUTE_FALLBACK,
  FARE_RATES_VERSION,
} from '../src/lib/fareRates.js'

const CAMPUS = { lat: 34.6788, lng: -82.843 }
const AIRPORTS = {
  GSP: { lat: 34.8956, lng: -82.2189 },
  CLT: { lat: 35.2144, lng: -80.9473 },
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const airport = body.airport ? String(body.airport).toUpperCase() : null
  const at = body.at ? new Date(body.at) : new Date()
  let miles = body.miles != null ? Number(body.miles) : null
  let minutes = body.minutes != null ? Number(body.minutes) : null
  let distanceM = body.distanceM != null ? Number(body.distanceM) : null
  let durationS = body.durationS != null ? Number(body.durationS) : null
  let routeSource = miles != null || distanceM != null ? 'caller' : 'fallback'

  if (body.origin && body.destination) {
    const route = await computeRoutes(body.origin, body.destination, body.intermediates || [])
    if (!route.error) {
      distanceM = route.distanceM
      durationS = route.durationS
      miles = null
      minutes = null
      routeSource = 'google'
    }
  } else if (airport && AIRPORTS[airport] && miles == null && distanceM == null) {
    const route = await computeRoutes(CAMPUS, AIRPORTS[airport], [])
    if (!route.error) {
      distanceM = route.distanceM
      durationS = route.durationS
      routeSource = 'google'
    } else {
      const fb = AIRPORT_ROUTE_FALLBACK[airport]
      miles = fb.miles
      minutes = fb.minutes
      routeSource = 'fallback'
    }
  } else if (airport && AIRPORT_ROUTE_FALLBACK[airport] && miles == null && distanceM == null) {
    miles = AIRPORT_ROUTE_FALLBACK[airport].miles
    minutes = AIRPORT_ROUTE_FALLBACK[airport].minutes
    routeSource = 'fallback'
  }

  let gameMul = null
  let isStudent = Boolean(body.isStudent)
  const sb = admin()
  if (sb) {
    const game = await loadGameDayMultiplier(sb, at)
    gameMul = game.multiplier
    const user = await userFromAuth(req)
    if (user) {
      const { data: profile } = await sb
        .from('profiles')
        .select('student_verified_at, email')
        .eq('id', user.id)
        .maybeSingle()
      isStudent = Boolean(profile?.student_verified_at) || isClemsonEmail(profile?.email || user.email)
    }
  }

  const touchesAirport = Boolean(airport) || Boolean(body.airport)
  const surge = resolveSurge({ at, airport: touchesAirport, gameDayMultiplier: gameMul })
  const quote = quoteFare({
    miles,
    minutes,
    distanceM,
    durationS,
    surgeMultiplier: surge.multiplier,
    isStudent,
    isCarpool: Boolean(body.isCarpool) || Number(body.passengers) >= 2,
    tier: body.tier || 'standard',
    vehicleMultiplier: Number(body.vehicleMultiplier) || 1,
  })

  return json(res, 200, {
    version: FARE_RATES_VERSION,
    routeSource,
    surge,
    quote,
    fareCents: quote.fareCents,
    platformFeeCents: quote.platformFeeCents,
    driverEarningsCents: quote.driverEarningsCents,
  })
}
