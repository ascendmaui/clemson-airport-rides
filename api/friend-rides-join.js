/**
 * POST /api/friend-rides-join
 * Soft auth ok — email + name. Caps at 5 total.
 */
import {
  admin, cors, json, parseBody, userFromAuth, loadRideByToken, MAX_PARTICIPANTS, publicRideSummary,
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

  const user = await userFromAuth(req)
  const displayName = (body.displayName || user?.user_metadata?.full_name || '').trim()
  const email = (body.email || user?.email || '').trim().toLowerCase() || null
  const pickup = body.pickup || null
  const dropoff = body.dropoff || null
  const participantId = body.participantId || null

  if (!displayName) return json(res, 400, { error: 'displayName required' })
  if (!pickup && !dropoff) return json(res, 400, { error: 'pickup and/or dropoff required' })

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const { ride, participants } = loaded

    if (['booked', 'canceled'].includes(ride.status)) {
      return json(res, 409, { error: `Ride is ${ride.status}` })
    }
    if (['awaiting_payment', 'ready'].includes(ride.status) && !participantId) {
      return json(res, 409, { error: 'Stops are locked while payment is in progress' })
    }

    let existing = null
    if (participantId) {
      existing = participants.find((p) => p.id === participantId)
    } else if (user?.id) {
      existing = participants.find((p) => p.user_id === user.id)
    } else if (email) {
      existing = participants.find((p) => (p.email || '').toLowerCase() === email)
    }

    if (existing) {
      if (existing.status === 'paid') {
        return json(res, 409, { error: 'Already paid — stops frozen' })
      }
      const { data: updated, error } = await sb
        .from('friend_ride_participants')
        .update({
          display_name: displayName,
          email: email || existing.email,
          user_id: user?.id || existing.user_id,
          pickup,
          dropoff,
          status: 'joined',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) return json(res, 500, { error: error.message })
      const reloaded = await loadRideByToken(sb, token)
      return json(res, 200, {
        participant: updated,
        ride: publicRideSummary(reloaded.ride, reloaded.participants),
      })
    }

    if (participants.length >= MAX_PARTICIPANTS) {
      return json(res, 409, { error: `Max ${MAX_PARTICIPANTS} participants (including organizer)` })
    }

    const { data: inserted, error } = await sb
      .from('friend_ride_participants')
      .insert({
        friend_ride_id: ride.id,
        user_id: user?.id || null,
        display_name: displayName,
        email,
        pickup,
        dropoff,
        status: 'joined',
      })
      .select('*')
      .single()
    if (error) return json(res, 500, { error: error.message })

    if (ride.status === 'draft') {
      await sb.from('friend_rides').update({ status: 'collecting' }).eq('id', ride.id)
    }

    const reloaded = await loadRideByToken(sb, token)
    return json(res, 200, {
      participant: inserted,
      ride: publicRideSummary(reloaded.ride, reloaded.participants),
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
