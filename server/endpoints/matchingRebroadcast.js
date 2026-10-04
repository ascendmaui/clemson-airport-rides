import { timingSafeEqual } from 'node:crypto'
import { admin, json } from '../friendRideLib.js'
import { rebroadcastMissedOffers } from '../matchingRebroadcast.js'

export default async function handler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const secret = String((deps.env || process.env).CRON_SECRET || '').trim()
  const header = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === 'authorization')?.[1]
  const token = /^Bearer\s+(.+)$/i.exec(String(header || '').trim())?.[1] || ''
  const expected = Buffer.from(secret)
  const supplied = Buffer.from(token)
  if (!secret || secret.includes('placeholder') || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return json(res, 401, { error: 'Cron authorization required' })
  }
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'Service unavailable' })
  const params = new URL(req.url || '/', 'http://localhost').searchParams
  const dryRun = String(req.query?.dry_run ?? params.get('dry_run')) === '1'
  try {
    const result = await rebroadcastMissedOffers(sb, { dryRun, ...(deps.now ? { now: deps.now } : {}) })
    return json(res, result.errors ? 500 : 200, { ok: result.errors === 0, ...result })
  } catch (error) {
    console.error('[matching-rebroadcast]', error.message)
    return json(res, 500, { error: 'Could not rebroadcast ride offers' })
  }
}
