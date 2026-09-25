/**
 * API error mapper for rider and native clients.
 * Prevents raw server config, environment variables, or internal traces from leaking to riders.
 */

export const UNAVAILABLE_COPY = 'Payments are temporarily unavailable, please try again shortly'
export const AUTH_REQUIRED_COPY = 'Please sign in again to continue.'
export const GENERIC_ERROR_COPY = 'Something went wrong. Please try again.'
export const NETWORK_ERROR_COPY = 'Check your connection and try again.'

export const UNAVAILABLE_PATTERN =
  /not configured|STRIPE_|SUPABASE_|service role|Payments unavailable|\b[A-Z0-9_]{2,}_(?:KEY|SECRET|TOKEN|URL|ID|ROLE|PASSWORD|ENV|API)\b/i

export const ENV_VAR_PATTERN =
  /\b(?:[A-Z0-9_]{2,}_(?:KEY|SECRET|TOKEN|URL|ID|ROLE|PASSWORD|ENV|API|BASE)|STRIPE_[A-Z0-9_]+|SUPABASE_[A-Z0-9_]+)\b/i

/**
 * Checks whether a server error string is clean and rider-facing,
 * or whether it is technical, code-like, or contains internal details.
 */
export function isUserFacing(msg) {
  if (typeof msg !== 'string') return false
  const text = msg.trim()
  if (!text) return false

  // Environment variable names or configuration mentions
  if (ENV_VAR_PATTERN.test(text) || UNAVAILABLE_PATTERN.test(text)) {
    return false
  }

  // Technical HTTP / server errors, stack traces, code snippets
  if (
    /^(?:internal\s+)?server\s+error$/i.test(text) ||
    /^bad\s+gateway$/i.test(text) ||
    /^gateway\s+timeout$/i.test(text) ||
    /^service\s+unavailable$/i.test(text) ||
    /^http\s*\d+/i.test(text) ||
    /^\d{3}(?:\s+[a-z]+)?$/i.test(text) ||
    /syntax\s*error|typeerror|referenceerror|rangeerror/i.test(text) ||
    /stack\s*trace/i.test(text) ||
    /\bat\s+\w+\.|\.js:\d+/i.test(text) ||
    /node_modules/i.test(text) ||
    /econnrefused|etimedout|enotfound/i.test(text) ||
    /\[object\s+object\]/i.test(text) ||
    /unhandled(?:promise)?rejection/i.test(text)
  ) {
    return false
  }

  // Raw single-token code identifiers with no spaces (e.g. 'card_declined', 'payment_intent_failed')
  if (/^[a-z0-9_]+$/i.test(text)) {
    return false
  }

  // Raw JSON strings
  if (text.startsWith('{') && text.endsWith('}')) {
    return false
  }

  return true
}

function extractText(body) {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (typeof body === 'object') {
    const parts = []
    if (typeof body.message === 'string') parts.push(body.message)
    if (typeof body.error === 'string') parts.push(body.error)
    else if (body.error && typeof body.error.message === 'string') parts.push(body.error.message)
    if (body.failure && typeof body.failure.message === 'string') parts.push(body.failure.message)
    if (typeof body.error_description === 'string') parts.push(body.error_description)
    if (typeof body.code === 'string') parts.push(body.code)
    if (typeof body.type === 'string') parts.push(body.type)
    if (body.payload) parts.push(extractText(body.payload))
    if (parts.length === 0) {
      try {
        return JSON.stringify(body)
      } catch {
        return String(body)
      }
    }
    return parts.join(' ')
  }
  return String(body)
}

function extractServerMessage(body) {
  if (body == null) return ''
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        return extractServerMessage(parsed)
      } catch {
        // Not JSON
      }
    }
    return trimmed
  }
  if (typeof body === 'object') {
    if (body.payload) {
      const fromPayload = extractServerMessage(body.payload)
      if (fromPayload) return fromPayload
    }
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim()
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    if (body.error && typeof body.error.message === 'string' && body.error.message.trim()) {
      return body.error.message.trim()
    }
    if (body.failure && typeof body.failure.message === 'string' && body.failure.message.trim()) {
      return body.failure.message.trim()
    }
    if (typeof body.error_description === 'string' && body.error_description.trim()) {
      return body.error_description.trim()
    }
  }
  return ''
}

function isCardError(status, body) {
  if (status === 402) return true
  if (!body || typeof body !== 'object') return false
  const type = String(body.type || body.failure?.type || body.payload?.type || '')
  const code = String(body.code || body.failure?.code || body.payload?.code || '')
  const declineCode = String(body.decline_code || body.failure?.decline_code || body.payload?.decline_code || '')
  if (type === 'card_error') return true
  if (code === 'card_declined' || code === 'expired_card' || code === 'insufficient_funds' || code === 'incorrect_cvc') return true
  if (declineCode) return true
  return false
}

/**
 * Maps an HTTP status code and response body to a safe, user-friendly error object.
 *
 * @param {number|string|null|undefined} status - HTTP status code (or 0/undefined for network errors)
 * @param {any} body - Response payload (string, object, or Error)
 * @returns {{ kind: 'unavailable' | 'auth' | 'card' | 'server' | 'network' | 'generic', message: string }}
 */
export function friendlyApiError(status, body) {
  // Support error object passed as first argument
  if (status && typeof status === 'object' && body === undefined) {
    body = status
    status = body.status ?? body.statusCode ?? body.code
  }

  const numStatus = status != null && status !== '' && !Number.isNaN(Number(status))
    ? Number(status)
    : undefined

  const rawText = extractText(body)

  // 1. 503, or any body text matching /not configured|STRIPE_|SUPABASE_|service role|Payments unavailable/i
  // Never return raw env var names.
  if (numStatus === 503 || UNAVAILABLE_PATTERN.test(rawText) || ENV_VAR_PATTERN.test(rawText)) {
    return {
      kind: 'unavailable',
      message: UNAVAILABLE_COPY,
    }
  }

  // 2. 401 -> kind 'auth', message 'Please sign in again to continue.'
  if (numStatus === 401) {
    return {
      kind: 'auth',
      message: AUTH_REQUIRED_COPY,
    }
  }

  // 3. Network error (status 0 / undefined / null) -> 'Check your connection and try again.'
  if (numStatus === 0 || numStatus === undefined) {
    return {
      kind: 'network',
      message: NETWORK_ERROR_COPY,
    }
  }

  // 4. 402/card errors keep the server message if it is user-facing; otherwise generic
  if (numStatus === 402 || isCardError(numStatus, body)) {
    const serverMsg = extractServerMessage(body)
    const message = isUserFacing(serverMsg) ? serverMsg : GENERIC_ERROR_COPY
    return {
      kind: 'card',
      message,
    }
  }

  // 5. 5xx other -> generic 'Something went wrong. Please try again.'
  if (numStatus >= 500 && numStatus <= 599) {
    return {
      kind: 'server',
      message: GENERIC_ERROR_COPY,
    }
  }

  // 6. Other statuses (e.g. 400, 403, 404, 422)
  const serverMsg = extractServerMessage(body)
  const message = isUserFacing(serverMsg) ? serverMsg : GENERIC_ERROR_COPY
  const result = {
    kind: 'generic',
    message,
  }

  // Extra guardrail: absolute guarantee that no env var name ever leaks into any returned message
  if (ENV_VAR_PATTERN.test(result.message)) {
    return {
      kind: 'unavailable',
      message: UNAVAILABLE_COPY,
    }
  }

  return result
}
