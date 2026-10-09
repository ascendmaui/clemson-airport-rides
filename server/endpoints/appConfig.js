import { json } from '../friendRideLib.js'

export function serverDemoBusyRoster(req, env = process.env) {
  try {
    if (env.DEMO_BUSY_ROSTER === '1') return true
    if (env.DEMO_BUSY_ROSTER === '0') return false
    const host = String(req?.headers?.host || '').toLowerCase()
    return env.ALLOW_STAGING_DRY_RUN === '1'
      || ['clemson-staging.', 'localhost', '127.0.0.1'].some((part) => host.includes(part))
  } catch { return false }
}

export default function handleAppConfig(req, res, deps = {}) {
  try {
    res.setHeader('Cache-Control', 'private, max-age=30')
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
    return json(res, 200, { demoBusyRoster: serverDemoBusyRoster(req, deps.env) })
  } catch { /* A disconnected response must never throw. Clients fall back. */ }
}
