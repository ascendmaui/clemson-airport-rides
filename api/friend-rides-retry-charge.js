/**
 * POST /api/friend-rides-retry-charge
 * Organizer or participant. Credits, then saved card, then Payment Element.
 */
import {
  admin, cors, json, parseBody, userFromAuth, loadRideByToken, stripeClient, stripeOk,
  maybeBookFriendRide, publicRideSummary,
} from '../server/friendRideLib.js'
import { chargeFriendShare } from '../server/chargeFriendShare.js'

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

  const { token, participantId, methods, paymentMethodId } = body
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

    const charged = await chargeFriendShare({
      sb,
      stripe,
      ride,
      participant: p,
      methods: Array.isArray(methods) && methods.length ? methods : ['credits', 'card'],
      paymentMethodId: paymentMethodId || null,
    })
    const book = charged.result?.status === 'paid'
      ? { booked: charged.result.booked, trip: charged.result.trip }
      : await maybeBookFriendRide(sb, ride.id)
    const reloaded = await loadRideByToken(sb, token)
    const failed = charged.result?.status === 'failed' || charged.result?.status === 'needs_card'
    return json(res, failed ? 402 : 200, {
      ...charged.result,
      paymentElement: charged.paymentElement || null,
      clientSecret: charged.paymentElement?.clientSecret || null,
      booked: book.booked,
      trip: book.trip || null,
      ride: publicRideSummary(reloaded.ride, reloaded.participants),
      failure: failed ? charged.result : null,
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
