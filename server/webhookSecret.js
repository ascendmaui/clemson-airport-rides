/**
 * Secret comparison for Hostinger mailbox webhooks and the draft-agent
 * schedule routes. The inbound webhook accepts Authorization: Bearer or
 * ?token= on the URL. Callers must not log the query string.
 */
import { timingSafeEqual } from 'node:crypto'

export function bearerToken(header) {
  const match = /^Bearer\s+(\S.*?)\s*$/i.exec(String(header || '').trim())
  if (!match) return ''
  return match[1].replace(/^["']|["']$/g, '').trim()
}

function decodeQueryComponent(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, '%2B')).trim()
  } catch {
    return ''
  }
}

/** First ?token= value. Malformed encoding yields an empty string and is not logged. */
export function queryToken(url) {
  const raw = String(url || '')
  const queryStart = raw.indexOf('?')
  if (queryStart < 0) return ''
  const query = raw.slice(queryStart + 1).split('#', 1)[0]
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = decodeQueryComponent(eq < 0 ? part : part.slice(0, eq))
    if (key !== 'token') continue
    if (eq < 0) return ''
    return decodeQueryComponent(part.slice(eq + 1))
  }
  return ''
}

/** Path plus any query keys other than token. The token value is dropped. */
export function redactQueryToken(url) {
  const raw = String(url || '')
  const hashAt = raw.indexOf('#')
  const beforeHash = hashAt < 0 ? raw : raw.slice(0, hashAt)
  const fragment = hashAt < 0 ? '' : raw.slice(hashAt)
  const queryStart = beforeHash.indexOf('?')
  if (queryStart < 0) return raw
  const path = beforeHash.slice(0, queryStart)
  const kept = []
  for (const part of beforeHash.slice(queryStart + 1).split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = decodeQueryComponent(eq < 0 ? part : part.slice(0, eq))
    if (key === 'token') continue
    kept.push(part)
  }
  return (kept.length ? `${path}?${kept.join('&')}` : path) + fragment
}

export function webhookSecretMatches(expected, supplied) {
  const secret = String(expected || '').trim()
  const token = String(supplied || '').trim()
  if (!secret || /placeholder/i.test(secret)) return false
  const left = Buffer.from(secret)
  const right = Buffer.from(token)
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function rememberSecret(map, key, value) {
  const secret = String(value || '').trim()
  const name = String(key || '').trim().toLowerCase()
  if (!secret || !name) return
  map.set(name, secret)
  const at = name.lastIndexOf('@')
  if (at > 0) map.set(name.slice(0, at), secret)
}

export function mailboxSecretMap(env) {
  const map = new Map()
  const raw = env?.HOSTINGER_MAIL_WEBHOOK_SECRETS
  let parsed = raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed)) rememberSecret(map, key, value)
  }
  return map
}

export function expectedWebhookSecret(env, route) {
  const map = mailboxSecretMap(env)
  if (route) {
    const specific = map.get(route.address) || map.get(route.local)
    if (specific) return specific
  }
  return env?.HOSTINGER_MAIL_WEBHOOK_SECRET || ''
}

export function headerValue(headers, name) {
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
