import { releaseScheduledRides } from '../releaseScheduledRides.js'
import { timingSafeEqual } from 'node:crypto'
import { admin, json } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { rebroadcastMissedOffers } from '../matchingRebroadcast.js'
import { expireStaleLiveOffers } from '../staleLiveOffer.js'

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
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const secret = String((deps.env || process.env).CRON_SECRET || '').trim()
  const token = bearerToken(headerValue(req.headers, 'authorization'))
  const expected = Buffer.from(secret)
  const supplied = Buffer.from(token)
  // A repeated Authorization header is an array on Vercel. Use the first value.
  // A cron header alone is not enough; the Vault bearer must match CRON_SECRET.
  if (!secret || secret.includes('placeholder') || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    console.error('[matching-rebroadcast] auth rejected', {
      secretLen: secret.length,
      tokenLen: token.length,
      headerType: Array.isArray(req.headers?.authorization) ? 'array' : typeof req.headers?.authorization,
    })
    return json(res, 401, { error: 'Cron authorization required' })
  }
  const env = deps.env || process.env
  const params = new URL(req.url || '/', 'http://localhost').searchParams
  const dryRun = String(req.query?.dry_run ?? params.get('dry_run')) === '1'
  const blocked = stagingCronBlock(env, { dryRun })
  if (blocked) return json(res, blocked.status, blocked.body)
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'Service unavailable' })
  try {
    const scheduled = await releaseScheduledRides(sb, { dryRun, ...(deps.now ? { now: deps.now } : {}) })
    const result = await rebroadcastMissedOffers(sb, { dryRun, ...(deps.now ? { now: deps.now } : {}) })
    const staleOffers = await expireStaleLiveOffers(sb, { dryRun, ...(deps.now ? { now: deps.now } : {}) })
    const errors = result.errors + scheduled.errors + staleOffers.errors
    return json(res, errors ? 500 : 200, { ok: errors === 0, ...result, scheduled, staleOffers })
  } catch (error) {
    console.error('[matching-rebroadcast]', error.message)
    return json(res, 500, { error: 'Could not rebroadcast ride offers' })
  }
}
