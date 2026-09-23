const buckets = new Map()

export function resetRateLimits() {
  buckets.clear()
}

export function baseHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Agent-Meta',
    ...extra,
  }
}

export function json(res, status, body) {
  res.statusCode = status
  for (const [key, value] of Object.entries(baseHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }))) {
    res.setHeader(key, value)
  }
  res.end(JSON.stringify(body))
}

export function cors(req, res) {
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return true
  }
  return false
}

export function parseBody(req) {
  let body = req.body
  if (typeof body === 'string') {
    if (body.length > 40_000) return { error: 'Message is too large' }
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return { error: 'Invalid JSON' }
    }
  }
  if (body && typeof body === 'object') {
    try {
      if (JSON.stringify(body).length > 40_000) return { error: 'Message is too large' }
    } catch {
      return { error: 'Invalid JSON' }
    }
  }
  return { body: body || {} }
}

function clientKey(req, userId) {
  const forwarded = req.headers?.['x-forwarded-for'] || ''
  const ip = String(forwarded).split(',')[0].trim() || req.socket?.remoteAddress || 'local'
  return userId || ip
}

/** Light in-memory limit per warm serverless instance. */
export function rateLimit(req, { bucket, userId, limit = 16, windowMs = 60_000 }) {
  const now = Date.now()
  const key = `${bucket}:${clientKey(req, userId)}`
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    buckets.set(key, recent)
    return false
  }
  recent.push(now)
  buckets.set(key, recent)
  return true
}

export function sanitizeMessages(input) {
  if (!Array.isArray(input)) return []
  const out = []
  for (const message of input.slice(-16)) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
    const content = String(message.content || '').replace(/\u0000/g, '').slice(0, 2000).trim()
    if (!content) continue
    out.push({ role: message.role, content })
  }
  return out
}

export const OFFLINE_NOTICE =
  'Live AI is offline. Set OPENAI_API_KEY or AI_GATEWAY_API_KEY on Vercel. Answers below use your account context and the Clemson RIDES knowledge base.'
