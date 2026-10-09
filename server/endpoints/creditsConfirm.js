/**
 * POST /api/credits-confirm { sessionId }
 * Grants a pack when Checkout succeeded, in case the webhook has not landed.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../friendRideLib.js'
import { grantCreditPack } from '../creditLots.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const stripeOkFn = deps.stripeOk || stripeOk
  if (!deps.stripe && !stripeOkFn()) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'Payments unavailable' })
  }

  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  }

  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 401, { error: 'Sign in required' })
  }

  const { body, error: pe } = parseBody(req)
  if (pe) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 400, { error: pe })
  }

  const rawSessionId = body?.sessionId || body?.session_id
  const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : null
  if (!sessionId) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 400, { error: 'sessionId required' })
  }

  try {
    const stripe = deps.stripe || (deps.stripeClient ? deps.stripeClient() : stripeClient())
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.metadata?.kind !== 'credit_purchase') {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, 400, { error: 'Not a credit purchase' })
    }
    if (session.metadata.profile_id !== user.id) {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, 403, { error: 'Not your purchase' })
    }
    if (session.payment_status !== 'paid') {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, 409, { error: 'Payment not completed', status: session.payment_status })
    }
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    const grantFn = deps.grantCreditPack || grantCreditPack
    const granted = await grantFn(sb, {
      profileId: user.id,
      packId: session.metadata.pack_id,
      stripePaymentIntentId: pi,
      stripeCheckoutSessionId: session.id,
    })
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, { ok: true, ...granted })
  } catch (err) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 500, { error: err.message || 'Could not confirm credits' })
  }
}
