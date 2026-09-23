/**
 * Pick a consolidated serverless action from the query string, the path
 * (including legacy filenames), or a body.action that is itself a route name.
 * Program sub-actions such as "ambassador" are ignored because they are not
 * in the allowed set.
 */

export function requestUrl(req) {
  const raw = req?.url || '/'
  try {
    return new URL(raw, 'http://localhost')
  } catch {
    return new URL('/', 'http://localhost')
  }
}

function headerValue(req, name) {
  const headers = req?.headers || {}
  const direct = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(direct)) return direct[0] || ''
  if (typeof direct === 'string') return direct
  return ''
}

function lastSegment(pathname) {
  return String(pathname || '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || ''
}

export function peekJsonBody(req) {
  const body = req?.body
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body
  if (typeof body !== 'string') return null
  try {
    const parsed = JSON.parse(body || '{}')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function pushAction(candidates, value) {
  if (Array.isArray(value)) {
    if (value.length) candidates.push(String(value[0]).trim())
    return
  }
  if (value == null) return
  const text = String(value).trim()
  if (text) candidates.push(text)
}

/**
 * @param {import('http').IncomingMessage & { query?: Record<string, unknown>, body?: unknown }} req
 * @param {{ allowed: Iterable<string>, legacy?: Record<string, string> }} options
 * @returns {string | null}
 */
export function resolveRouteAction(req, { allowed, legacy = {} }) {
  const allow = allowed instanceof Set ? allowed : new Set(allowed)
  const url = requestUrl(req)
  const candidates = []

  pushAction(candidates, url.searchParams.get('action'))
  pushAction(candidates, req?.query?.action)

  const paths = [
    url.pathname,
    headerValue(req, 'x-vercel-original-url'),
    headerValue(req, 'x-invoke-path'),
    headerValue(req, 'x-matched-path'),
    headerValue(req, 'x-forwarded-uri'),
  ]
  for (const path of paths) {
    if (!path) continue
    const segment = lastSegment(path.split('?')[0])
    if (!segment) continue
    candidates.push(segment)
    if (legacy[segment]) candidates.push(legacy[segment])
  }

  const body = peekJsonBody(req)
  if (body && typeof body.action === 'string') pushAction(candidates, body.action)

  for (const candidate of candidates) {
    if (allow.has(candidate)) return candidate
  }
  return null
}
