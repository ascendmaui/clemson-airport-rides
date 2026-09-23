/**
 * POST /api/friend-rides-retry-charge
 * Organizer or participant. Retries off_session or returns Payment Element secret.
 */
import {
  admin, cors, json, parseBody, userFromAuth, loadRideByToken, stripeClient, stripeOk,
  publicRideSummary,
} from '../server/friendRideLib.js'
import { chargeFriendShare } from '../server/chargeShare.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) {
    return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY not configured' })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const { token, participantId } = body
  if (!token || !participantId) return json(res, 400, { error: 'token and participantId required' })

  const stripe = stripeClient()

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const { ride, participants } = loaded
    const p = participants.find((x) => x.id === participantId)
    if (!p) return json(res, 404, { error: 'Participant not found' })
    if (p.status === 'paid') return json(res, 200, { status: 'already_paid' })

    const isOrg = user && user.id === ride.organizer_id
    const isSelf = user && p.user_id && user.id === p.user_id
    if (!isOrg && !isSelf) return json(res, 403, { error: 'Not allowed' })

    const charged = await chargeFriendShare(sb, stripe, {
      ride,
      participant: p,
      actingUserId: user?.id,
      useCredits: body.useCredits !== false,
    })
    const reloaded = await loadRideByToken(sb, token)
    return json(res, charged.result.status === 'failed' ? 402 : 200, {
      ...charged.result,
      clientSecret: charged.secret?.clientSecret || null,
      ride: publicRideSummary(reloaded.ride, reloaded.participants),
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
