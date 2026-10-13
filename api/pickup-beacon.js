/**
 * GET/POST /api/pickup-beacon?tripId=
 * Returns the pickup code only to that trip's rider or its matched driver.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { readPickupBeacon } from '../server/pickupBeacon.js'

function requestedTripId(req) {
  const parsed = parseBody(req)
  const body = parsed.error ? {} : (parsed.body || {})
  const fromBody = body.tripId || body.trip_id
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim()
  const raw = String(req.url || '')
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  return String(params.get('tripId') || params.get('trip_id') || '').trim()
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' })
  }
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { ok: false, error: 'Sign in required' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { ok: false, error: 'Service unavailable' })
  try {
    const result = await readPickupBeacon(sb, user, requestedTripId(req))
    return json(res, result.status, result.body)
  } catch (err) {
    return json(res, 500, { ok: false, error: err?.message || 'Could not load the pickup code' })
  }
}
