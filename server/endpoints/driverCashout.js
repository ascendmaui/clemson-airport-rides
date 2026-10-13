/**
 * GET  /api/driver?action=cashout  quote for the signed-in driver
 * POST /api/driver?action=cashout  { confirm: true, feeCents } executes one instant cash-out
 */
import { admin, cors, json, parseBody, stripeClient, userFromAuth } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { cashoutQuote, executeCashout } from '../cashout.js'

export default async function handleDriverCashout(req, res, deps = {}) {
  if (cors(req, res)) return
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const stripe = deps.stripe !== undefined ? deps.stripe : stripeClient()
  const env = deps.env || process.env
  try {
    if (req.method === 'GET') {
      const quote = await cashoutQuote({ sb, stripe, driverId: user.id, env })
      delete quote.connectAccountId
      return json(res, 200, quote)
    }
    const blocked = stagingCronBlock(env, { dryRun: false })
    if (blocked) return json(res, blocked.status, blocked.body)
    const { body, error } = parseBody(req)
    if (error) return json(res, 400, { error })
    if (body.confirm !== true) return json(res, 400, { error: 'confirm_required' })
    if (!stripe) return json(res, 503, { error: 'Stripe not configured' })
    const method = body.method === 'instant' || body.method === 'standard' ? body.method : null
    const result = await executeCashout({ sb, stripe, driverId: user.id, expectedFeeCents: body.feeCents, method, env })
    const { status = 200, quote, ...rest } = result
    if (quote) delete quote.connectAccountId
    return json(res, result.ok ? 200 : status, quote ? { ...rest, quote } : rest)
  } catch (err) {
    console.error('[cashout]', err?.message)
    return json(res, 500, { error: 'cashout_failed' })
  }
}
