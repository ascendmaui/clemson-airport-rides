/**
 * GET  /api/driver?action=payout-methods
 * POST /api/driver?action=payout-methods  { op: 'setup' | 'cashout', method, feeCents, confirm }
 *
 * Stripe Connect Express. STRIPE_SECRET_KEY may be test or live; live money needs admin approval.
 */
import { admin, cors, json, parseBody, stripeClient, userFromAuth } from '../friendRideLib.js'
import { appOrigin } from './driverW9.js'
import { cashOutDriver, loadPayoutDesk, startDirectDeposit } from '../driverPayoutMethods.js'
import { expressKeyAllowed } from '../../shared/driverPayoutMethods.js'

export default async function handleDriverPayoutMethods(req, res, deps = {}) {
  if (cors(req, res)) return
  res.setHeader?.('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const env = deps.env || process.env
  if (!expressKeyAllowed(env.STRIPE_SECRET_KEY)) {
    return json(res, 403, { error: 'live_keys_blocked' })
  }
  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const stripe = deps.stripe !== undefined ? deps.stripe : stripeClient()
  const origin = appOrigin(req)
  try {
    if (req.method === 'GET') {
      const desk = await loadPayoutDesk({ sb, stripe, driverId: user.id, env, origin })
      return json(res, desk.ok === false ? desk.status || 403 : 200, desk)
    }
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    const body = parsed.body || {}
    if (body.op === 'setup') {
      const started = await startDirectDeposit({ sb, stripe, user, env, origin })
      return json(res, started.ok ? 200 : started.status || 400, started)
    }
    if (body.op === 'cashout') {
      if (body.confirm !== true) return json(res, 400, { error: 'confirm_required' })
      if (!stripe) return json(res, 503, { error: 'Stripe not configured' })
      const result = await cashOutDriver({
        sb,
        stripe,
        driverId: user.id,
        method: body.method,
        expectedFeeCents: body.feeCents,
        env,
        now: deps.now,
      })
      const { status = 200, quote, ...rest } = result
      if (quote) delete quote.connectAccountId
      return json(res, result.ok ? 200 : status, quote ? { ...rest, quote } : rest)
    }
    return json(res, 400, { error: 'Use op=setup or op=cashout' })
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : 'Could not load payout methods' })
  }
}
