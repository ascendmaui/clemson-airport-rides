/**
 * POST /api/stripe-payment-methods?action=reconcile-checkout
 * Body: { sessionId: string }
 *
 * Rider fallback when Stripe Checkout completes and returns to the app,
 * in case the webhook has not landed or was misconfigured.
 * Reconciles the deposit session idempotently for the signed-in user.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../friendRideLib.js'
import { reconcileCheckoutSession } from '../checkoutReconcile.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const stripeOkFn = deps.stripeOk || stripeOk
  if (!deps.stripe && !stripeOkFn()) {
    return json(res, 503, { error: 'Payments unavailable' })
  }

  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) {
    return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  }

  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req)
  if (!user) {
    return json(res, 401, { error: 'Sign in required' })
  }

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const sessionId = body?.sessionId || body?.session_id
  if (!sessionId || typeof sessionId !== 'string') {
    return json(res, 400, { error: 'sessionId required' })
  }

  const stripe = deps.stripe || stripeClient()
  const reconcileFn = deps.reconcileCheckoutSession || reconcileCheckoutSession
  try {
    const result = await reconcileFn({
      stripe,
      sb,
      sessionId,
      userId: user.id,
      ...deps,
    })

    const status = result?.status || (result?.ok ? 200 : 500)
    return json(res, status, result)
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Could not reconcile checkout' })
  }
}
