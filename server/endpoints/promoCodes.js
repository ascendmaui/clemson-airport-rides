/**
 * Rider and driver promo codes (campaign codes created by the admin).
 *
 * POST /api/promo/check     { code, side: 'rider'|'driver', fareCents? }  preview, reserves nothing
 * POST /api/promo/claim     { code, side, deviceId? }  attach a code at sign-up (idempotent)
 * GET  /api/promo/campaigns  public marketing feed: opt-in, live rider codes only
 *
 * Mounted on /api/weekly-coupon?action=promo-* (vercel.json rewrites) so no new
 * serverless function is added. Booking-time redemption happens inside
 * request-driver, never from the client directly.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { checkPromo, claimPromo, publicCampaigns } from '../promoCodes.js'
import { PROMO_SIDES } from '../../shared/promoCodes.js'

export const PROMO_ACTIONS = ['promo-check', 'promo-claim', 'promo-campaigns']

export default async function handlePromoCodes(req, res, action, deps = {}) {
  if (cors(req, res)) return
  res.setHeader?.('Cache-Control', action === 'promo-campaigns' ? 'public, max-age=300' : 'no-store')
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  if (action === 'promo-campaigns') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
    try {
      return json(res, 200, { campaigns: await publicCampaigns(sb, { now: deps.now }) })
    } catch (err) {
      console.error('[promo] campaigns', err?.message || err)
      return json(res, 500, { error: 'Could not load campaigns' })
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required', reason: 'sign_in_required' })
  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { error })
  const side = String(body.side || 'rider').toLowerCase()
  if (!PROMO_SIDES.includes(side)) return json(res, 400, { error: 'side must be rider or driver' })
  try {
    if (action === 'promo-check') {
      const fare = body.fareCents == null || body.fareCents === '' ? null : Number(body.fareCents)
      const result = await checkPromo(sb, {
        userId: user.id, code: body.code, side, fareCents: Number.isFinite(fare) ? fare : null,
      })
      return json(res, 200, result)
    }
    const result = await claimPromo(sb, { userId: user.id, code: body.code, side, deviceId: body.deviceId })
    return json(res, 200, result)
  } catch (err) {
    console.error('[promo]', action, err?.message || err)
    return json(res, 500, { ok: false, reason: 'promo_unavailable', error: 'Could not check that code' })
  }
}
