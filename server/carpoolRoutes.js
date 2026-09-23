/**
 * Carpool match, group link, and program handlers.
 * Served by /api/carpool. Response bodies match the previous standalone routes.
 */
import { admin, cors, json, parseBody, userFromAuth } from './friendRideLib.js'
import { ambassadorFrom, ambassadorStats, createGroupRide, matchRider } from './carpoolService.js'
import { firstRideWindowOpen } from '../src/lib/carpoolEngine.js'
import { gameDayActive } from './carpoolSettle.js'

export async function handleCarpoolMatch(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  if (!body.pickup?.lat || !body.dropoff?.lat) {
    return json(res, 400, { error: 'pickup and dropoff with lat/lng are required' })
  }
  try {
    const result = await matchRider(sb, {
      user,
      pickup: body.pickup,
      dropoff: body.dropoff,
      departAt: body.departAt || null,
      displayName: body.displayName,
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      ambassadorCode: ambassadorFrom(body),
    })
    return json(res, result.ok === false ? 400 : 200, result)
  } catch (err) {
    console.error('[carpool-match]', err)
    return json(res, 500, { error: err.message || 'Match failed' })
  }
}

export async function handleCarpoolGroup(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  if (!body.pickup?.lat || !body.dropoff?.lat) {
    return json(res, 400, { error: 'pickup and dropoff with lat/lng are required' })
  }
  try {
    const result = await createGroupRide(sb, {
      user,
      pickup: body.pickup,
      dropoff: body.dropoff,
      displayName: body.displayName,
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      driving: Boolean(body.driving),
      ambassadorCode: ambassadorFrom(body),
    })
    return json(res, 200, result)
  } catch (err) {
    console.error('[carpool-group]', err)
    return json(res, 500, { error: err.message || 'Could not create group link' })
  }
}

export async function handleCarpoolProgram(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const action = body.action === 'first_ride' ? 'first_ride' : 'ambassador'

  try {
    if (action === 'ambassador') {
      const stats = await ambassadorStats(sb, user)
      const origin = body.origin || 'https://clemson-airport-rides.vercel.app'
      return json(res, stats.ok === false ? 503 : 200, {
        ...stats,
        link: stats.code ? `${origin}/a/${stats.code}` : null,
      })
    }

    const now = new Date()
    const gameDay = await gameDayActive(sb, now)
    const windowOpen = firstRideWindowOpen(now, { gameDay })
    const grant = await sb.from('first_ride_grants').select('user_id, created_at').eq('user_id', user.id).maybeSingle()
    const prior = await sb
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('rider_id', user.id)
      .eq('status', 'completed')
    const schemaMissing = /relation|does not exist|schema cache/i.test(grant.error?.message || '')
    const eligible = windowOpen && !schemaMissing && !grant.data && !prior.error && (prior.count || 0) === 0
    return json(res, 200, {
      ok: true,
      code_type: 'first_ride',
      windowOpen,
      gameDay,
      alreadyUsed: Boolean(grant.data),
      completedTrips: prior.count || 0,
      eligible,
      schemaMissing,
    })
  } catch (err) {
    console.error('[carpool-program]', err)
    return json(res, 500, { error: err.message || 'Program lookup failed' })
  }
}
