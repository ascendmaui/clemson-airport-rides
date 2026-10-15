/**
 * Promo code admin. Only johnmatveyev@gmail.com (confirmed email) may call it;
 * see isPromoAdmin in server/promoCodes.js. Anyone else gets 403, including
 * other admins and support staff.
 *
 * GET  /api/admin?action=promo-codes
 * GET  /api/admin?action=promo-export[&campaign=…][&format=json]  CSV by default
 * POST /api/admin?action=promo-create  { code? | prefix+count, side, discountType, percentOff|amountOffCents,
 *                                        maxDiscountCents?, minTripCents?, startsAt?, expiresAt, maxRedemptions,
 *                                        perAccountLimit?, limitPerDevice?, limitPerCard?, budgetCents?,
 *                                        publicListing?, campaign?, notes? }
 * POST /api/admin?action=promo-update  { id, active?|expiresAt?|maxRedemptions?|publicListing?|notes?|campaign?|budgetCents? }
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import {
  createPromoCodes, exportPromoCodes, isPromoAdmin, listPromoCodes, updatePromoCode,
} from '../promoCodes.js'
import { PROMO_LIMITS } from '../../shared/promoCodes.js'

export const PROMO_ADMIN_ACTIONS = ['promo-codes', 'promo-export', 'promo-create', 'promo-update']
const GETS = new Set(['promo-codes', 'promo-export'])

function query(req, name) {
  const q = req?.query
  if (q && typeof q === 'object' && q[name] != null) return String(Array.isArray(q[name]) ? q[name][0] : q[name])
  const url = String(req?.url || '')
  const i = url.indexOf('?')
  return i === -1 ? '' : (new URLSearchParams(url.slice(i + 1)).get(name) || '')
}

export default async function handlePromoAdmin(req, res, action, deps = {}) {
  if (cors(req, res)) return
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  if (GETS.has(action) ? req.method !== 'GET' : req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  if (!isPromoAdmin(user)) return json(res, 403, { error: 'promo_admin_only' })
  const actor = { id: user.id, email: user.email }
  try {
    if (action === 'promo-codes') {
      return json(res, 200, { admin: true, limits: PROMO_LIMITS, codes: await listPromoCodes(sb) })
    }
    if (action === 'promo-export') {
      const out = await exportPromoCodes(sb, { actor, campaign: query(req, 'campaign') || null })
      if (query(req, 'format') === 'json') return json(res, 200, out)
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="clemson-rides-promo-codes.csv"')
      return res.end(out.csv)
    }
    const blocked = stagingCronBlock(deps.env || process.env, { dryRun: false })
    if (blocked) return json(res, blocked.status, blocked.body)
    const { body, error } = parseBody(req)
    if (error) return json(res, 400, { error })
    const result = action === 'promo-create'
      ? await createPromoCodes(sb, { actor, input: body, now: deps.now, random: deps.random })
      : await updatePromoCode(sb, { actor, id: String(body.id || ''), patch: body.patch || {}, now: deps.now })
    if (!result.ok) return json(res, result.status || 400, { error: result.error, errors: result.errors })
    return json(res, 200, result)
  } catch (err) {
    console.error('[promo-admin]', action, err?.message || err)
    return json(res, 500, { error: 'promo_admin_failed' })
  }
}
