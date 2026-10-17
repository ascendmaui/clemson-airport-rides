/**
 * POST /api/account?action=delete
 * Deletes the signed-in account immediately. Body: { confirm: "DELETE" }.
 */
import { adminClient, userFromAuth } from '../supabaseAdmin.js'
import { cors, json, parseBody, stripeClient } from '../friendRideLib.js'
import { resolveRouteAction } from '../routeAction.js'
import { deleteAccount } from '../accountDeletion.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: ['delete'] })
  if (req.method !== 'POST' || action !== 'delete') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })
  if (String(parsed.body?.confirm || '') !== 'DELETE') {
    return json(res, 400, { error: 'Type DELETE to confirm account deletion.' })
  }

  const sb = deps.sb !== undefined ? deps.sb : adminClient()
  if (!sb) return json(res, 503, { error: 'Account deletion is temporarily unavailable. Try again shortly.' })

  const user = deps.user !== undefined ? deps.user : await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  try {
    const result = await deleteAccount(sb, user, {
      stripe: deps.stripe !== undefined ? deps.stripe : stripeClient(),
      env: deps.env || process.env,
      fetch: deps.fetch,
      now: deps.now,
      warn: deps.warn,
      releaseHold: deps.releaseHold,
    })
    if (result.blocked) return json(res, result.status, { error: result.error, code: result.code })
    return json(res, 200, { ok: true, deleted: true, idempotent: Boolean(result.idempotent) })
  } catch (error) {
    const status = Number(error?.status) || 500
    if (status >= 500) console.error('[account-delete]', error?.message || error)
    const message = status >= 500
      ? 'Could not delete the account. Try again.'
      : (error?.message || 'Could not delete the account. Try again.')
    return json(res, status, { error: message, ...(error?.code ? { code: error.code } : {}) })
  }
}
