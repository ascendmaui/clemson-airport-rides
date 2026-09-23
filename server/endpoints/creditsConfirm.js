/**
 * POST /api/credits-confirm { sessionId }
 * Grants a pack when Checkout succeeded, in case the webhook has not landed.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../friendRideLib.js'
import { grantCreditPack } from '../creditLots.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) return json(res, 503, { error: 'Payments unavailable' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const sessionId = body.sessionId || body.session_id
  if (!sessionId) return json(res, 400, { error: 'sessionId required' })

  try {
    const stripe = stripeClient()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.metadata?.kind !== 'credit_purchase') {
      return json(res, 400, { error: 'Not a credit purchase' })
    }
    if (session.metadata.profile_id !== user.id) return json(res, 403, { error: 'Not your purchase' })
    if (session.payment_status !== 'paid') return json(res, 409, { error: 'Payment not completed', status: session.payment_status })
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    const granted = await grantCreditPack(sb, {
      profileId: user.id,
      packId: session.metadata.pack_id,
      stripePaymentIntentId: pi,
      stripeCheckoutSessionId: session.id,
    })
    return json(res, 200, { ok: true, ...granted })
  } catch (err) {
    return json(res, 500, { error: err.message || 'Could not confirm credits' })
  }
}
