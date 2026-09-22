/**
 * GET /api/friend-rides-get?token=...
 * Public summary via service role (avoids RLS fights).
 */
import { admin, cors, json, loadRideByToken, publicRideSummary, userFromAuth } from '../server/friendRideLib.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  let token = ''
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost')
    token = url.searchParams.get('token') || ''
  } else {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    token = body.token || ''
  }
  if (!token) return json(res, 400, { error: 'token required' })

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const summary = publicRideSummary(loaded.ride, loaded.participants)

    // Trust UI fields (student badge + ratings) — public enough for lobby.
    const ids = loaded.participants.map((p) => p.user_id).filter(Boolean)
    let byId = {}
    if (ids.length) {
      const { data: profiles } = await sb
        .from('profiles')
        .select('id, stripe_default_pm_id, stripe_customer_id, student_verified_at, rating_avg, rating_count, avatar_url, full_name')
        .in('id', ids)
      byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
      summary.participants = summary.participants.map((p) => {
        const full = loaded.participants.find((x) => x.id === p.id)
        const prof = full?.user_id ? byId[full.user_id] : null
        return {
          ...p,
          student_verified_at: prof?.student_verified_at || null,
          rating_avg: prof?.rating_avg != null ? Number(prof.rating_avg) : null,
          rating_count: prof?.rating_count != null ? Number(prof.rating_count) : 0,
          avatar_url: prof?.avatar_url || null,
        }
      })
    }

    const user = await userFromAuth(req)
    if (user) {
      if (ids.length) {
        summary.participants = summary.participants.map((p) => {
          const full = loaded.participants.find((x) => x.id === p.id)
          const prof = full?.user_id ? byId[full.user_id] : null
          return {
            ...p,
            email: user.id === loaded.ride.organizer_id || user.id === full?.user_id
              ? full?.email
              : p.email,
            has_card: Boolean(prof?.stripe_default_pm_id),
            is_self: full?.user_id === user.id,
          }
        })
      }
      summary.is_organizer = user.id === loaded.ride.organizer_id
      summary.is_driver = Boolean(
        loaded.ride.driver_profile_id && user.id === loaded.ride.driver_profile_id,
      )
      summary.viewer_id = user.id
    }

    return json(res, 200, summary)
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
