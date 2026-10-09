/**
 * GET or POST /api/stripe-payment-methods?action=tiger-pass
 * Frequent-rider pass. The display name comes from TIGER_PASS_NAME.
 * ops: status, checkout, confirm, cancel, preferences
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, ensureStripeCustomer,
} from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import {
  cancelTigerPass,
  confirmTigerPassCheckout,
  loadRiderPass,
  savePassPreferences,
  startTigerPassCheckout,
} from '../riderPass.js'

function fail(res, error) {
  const status = error?.status || 500
  return json(res, status, {
    error: error?.message || 'Could not update the pass',
    code: error?.code || undefined,
  })
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const now = deps.now instanceof Date ? deps.now : new Date()

  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body || {}
  }
  const op = String(body.op || (req.method === 'GET' ? 'status' : 'status'))
  const runEnsure = deps.ensureProfile || ensureProfile

  try {
    if (op !== 'status') {
      const profile = await runEnsure(sb, user)
      if (!profile?.ok) return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
    }
    if (op === 'status') return json(res, 200, await loadRiderPass(sb, user.id, now))
    if (op === 'preferences') return json(res, 200, await savePassPreferences(sb, user.id, body, now))
    if (op === 'cancel') {
      const stripe = deps.stripe !== undefined ? deps.stripe : (stripeOk() ? stripeClient() : null)
      return json(res, 200, await cancelTigerPass(sb, user, { stripe, now }))
    }
    if (op === 'checkout') {
      const stripeOkFn = deps.stripeOk || stripeOk
      const stripe = deps.stripe || (stripeOkFn() ? stripeClient() : null)
      if (!stripe) return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY is not configured.' })
      const session = await startTigerPassCheckout(sb, user, body, {
        stripe,
        ensureStripeCustomer: deps.ensureStripeCustomer || ensureStripeCustomer,
      })
      return json(res, 200, session)
    }
    if (op === 'confirm') {
      const stripeOkFn = deps.stripeOk || stripeOk
      const stripe = deps.stripe || (stripeOkFn() ? stripeClient() : null)
      const status = await confirmTigerPassCheckout(sb, user, body.sessionId || body.session_id, { stripe, now })
      return json(res, 200, status)
    }
    return json(res, 400, { error: 'Unknown pass action. Use status, checkout, confirm, cancel, or preferences.' })
  } catch (error) {
    return fail(res, error)
  }
}
