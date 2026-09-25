/**
 * agentHttp.js is pure (in-memory rate limit, no network).
 * json, cors, parseBody, and the bucket map stay the real implementation.
 * rateLimit is wrapped only so tests can see the options the handler passed.
 */
import * as real from '../../../server/agentHttp.js'

export const rateLimitCalls = []

export function rateLimit(req, options) {
  rateLimitCalls.push(options)
  return real.rateLimit(req, options)
}

export const {
  cors,
  json,
  parseBody,
  resetRateLimits,
  baseHeaders,
  sanitizeMessages,
  OFFLINE_NOTICE,
} = real
