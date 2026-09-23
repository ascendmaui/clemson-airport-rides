/**
 * GET /api/referral-preview?code=TGR-XXXXXX
 * Public check used at sign-up. Returns the referrer's first name only.
 */
import { admin, cors, json } from '../server/friendRideLib.js'
import { previewReferralCode } from '../server/referralService.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const url = new URL(req.url || '/', 'http://localhost')
  const code = (req.query && req.query.code) || url.searchParams.get('code') || ''

  try {
    const result = await previewReferralCode(sb, code)
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[referral-preview]', err)
    return json(res, 500, { error: err.message || 'Could not look up referral code' })
  }
}
