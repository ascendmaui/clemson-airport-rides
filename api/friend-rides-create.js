/**
 * POST /api/friend-rides-create
 * Auth required. Creates friend_rides + organizer participant.
 */
import {
  admin, cors, json, parseBody, userFromAuth, randomToken, MAX_PARTICIPANTS,
} from '../server/friendRideLib.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const displayName =
    body.displayName ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Organizer'
  const pickup = body.pickup || null
  const dropoff = body.dropoff || null
  const splitMode = body.splitMode === 'by_distance' ? 'by_distance' : 'even'

  const token = randomToken(18)
  const { data: ride, error } = await sb
    .from('friend_rides')
    .insert({
      organizer_id: user.id,
      token,
      status: 'collecting',
      split_mode: splitMode,
      stops: [],
    })
    .select('*')
    .single()
  if (error) return json(res, 500, { error: error.message })

  const { data: participant, error: pErr } = await sb
    .from('friend_ride_participants')
    .insert({
      friend_ride_id: ride.id,
      user_id: user.id,
      display_name: displayName,
      email: user.email || null,
      pickup,
      dropoff,
      status: pickup || dropoff ? 'joined' : 'invited',
    })
    .select('*')
    .single()
  if (pErr) return json(res, 500, { error: pErr.message })

  return json(res, 200, {
    ride,
    participant,
    token: ride.token,
    urlPath: `/friends/${ride.token}`,
    maxParticipants: MAX_PARTICIPANTS,
  })
}
