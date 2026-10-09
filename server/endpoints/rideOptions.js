/**
 * GET or POST /api/stripe-payment-methods?action=ride-options
 * Optional scheduled_for (ISO) or date+time (Eastern, same as schedule-trip).
 * Returns only tiers a driver can serve. Clients poll about every 10 seconds.
 */
import { isE2ETestUser } from '../../shared/e2eTestAccounts.js'
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { parseRideAt } from '../authoritativeFare.js'
import { loadRideAvailability } from '../rideAvailability.js'

function scheduledForFrom(body, now) {
  if (!body) return null
  const explicit = body.scheduled_for || body.scheduledFor || body.pickupAt || body.at
  if (explicit) {
    const parsed = new Date(explicit)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  if (body.date) return parseRideAt(body, now)
  return null
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb || admin()
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  const now = deps.now instanceof Date ? deps.now : new Date()
  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body || {}
  } else {
    const url = new URL(req.url || '/', 'http://localhost')
    body = {
      scheduled_for: url.searchParams.get('scheduled_for') || url.searchParams.get('scheduledFor'),
      date: url.searchParams.get('date'),
      time: url.searchParams.get('time'),
    }
  }
  const when = scheduledForFrom(body, now)
  const snapshot = await loadRideAvailability(sb, { scheduledFor: when, now, riderIsE2E: isE2ETestUser(user) })
  if (snapshot.error && !snapshot.availableTierIds.length) {
    return json(res, 200, snapshot)
  }
  return json(res, 200, snapshot)
}
