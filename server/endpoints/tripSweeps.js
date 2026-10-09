import { timingSafeEqual } from 'node:crypto'
import { admin, json } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { sweepCanceledHolds } from '../canceledHoldSweep.js'

const SWEEPS = [{ name: 'canceled_holds', run: sweepCanceledHolds }]

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
    console.error('[trip-sweeps] auth rejected', {
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
  const results = {}
  const total = { released: 0, failed: 0, skipped: 0, ids: { released: [], failed: [], skipped: [] } }
  let errors = 0
  for (const sweep of deps.sweeps || SWEEPS) {
    try {
      const result = await sweep.run(sb, { dryRun, now: deps.now, stripe: deps.stripe })
      results[sweep.name] = result
      for (const key of ['released', 'failed', 'skipped']) {
        total[key] += result[key] || 0
        total.ids[key].push(...(result.ids?.[key] || []))
      }
    } catch (error) {
      errors += 1
      console.error('[trip-sweeps]', sweep.name, error?.message || error)
      results[sweep.name] = { error: 'Sweep failed' }
    }
  }
  const ok = errors === 0 && total.failed === 0
  return json(res, ok ? 200 : 500, { ok, ...total, sweeps: results })
}
