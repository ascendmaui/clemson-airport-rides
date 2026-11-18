/**
 * POST /api/driver?action=admin-signup-alert
 * Called by the auth.users / profiles trigger through pg_net. Cron bearer
 * required. The push recipient is always John's admin account.
 */
import { timingSafeEqual } from 'node:crypto'
import { admin, json } from '../friendRideLib.js'
import { peekJsonBody } from '../routeAction.js'
import { deliverAdminSignupAlert } from '../adminSignupAlert.js'

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const want = name.toLowerCase()
  const direct = headers[name] ?? headers[want]
  if (Array.isArray(direct)) return direct[0] == null ? '' : String(direct[0])
  if (direct != null) return String(direct)
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== want) continue
    const raw = headers[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    return value == null ? '' : String(value)
  }
  return ''
}

function bearerToken(header) {
  const match = /^Bearer\s+(\S.*?)\s*$/i.exec(String(header || '').trim())
  if (!match) return ''
  return match[1].replace(/^["']|["']$/g, '').trim()
}

export default async function handler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const env = deps.env || process.env
  const secret = String(env.CRON_SECRET || '').trim()
  const token = bearerToken(headerValue(req.headers, 'authorization'))
  const expected = Buffer.from(secret)
  const supplied = Buffer.from(token)
  if (!secret || secret.includes('placeholder') || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return json(res, 401, { error: 'Cron authorization required' })
  }
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'Service unavailable' })
  const body = peekJsonBody(req) || {}
  try {
    const result = await deliverAdminSignupAlert(sb, body, { ...deps, env })
    if (!result.ok) return json(res, 400, { error: 'Signup user id is required' })
    return json(res, 200, {
      ok: true,
      pushed: result.pushed,
      reason: result.reason,
      recipientId: result.recipientId,
    })
  } catch (error) {
    console.error('[admin-signup-alert]', error?.message || error)
    return json(res, 500, { error: 'Signup alert failed' })
  }
}
