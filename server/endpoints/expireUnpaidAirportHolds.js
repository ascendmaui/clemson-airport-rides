/**
 * GET or POST /api/expire-unpaid-airport-holds
 *
 * Cancels unpaid airport-deposit searching, offered, and scheduled holds
 * older than 20 minutes (UNPAID_AIRPORT_HOLD_TTL_MS). The age anchor is the
 * later of trips.created_at and metadata.stripe_checkout_created_at. The
 * cancel reuses abandonedCheckout: status canceled, checkout_abandoned
 * stamped, and one trip_events row with reason unpaid_hold_ttl. A later paid
 * deposit webhook restores the trip the same way as Checkout abandon.
 *
 * An external cron calls this about every 15 minutes. Overlapping calls are
 * safe: the hold update matches only while status is still in that set and
 * checkout_abandoned is unset, and only that winner writes trip_events or
 * expires the Stripe Checkout session. Each call scans at most 40 holds.
 * Do not add a 15-minute schedule to vercel.json — Hobby deploys reject it.
 *
 * Authorization. No new secret; reuse CRON_SECRET.
 * - External callers send Authorization: Bearer $CRON_SECRET. The secret is
 *   trimmed. The compare uses crypto.timingSafeEqual on equal-length buffers.
 *   Header name casing does not matter. A wrong or missing bearer is 401.
 * - x-vercel-cron: 1 is accepted only when CRON_SECRET is unset or a
 *   placeholder AND process.env.VERCEL is set (a Vercel Cron invocation).
 *   Off Vercel that header is ignored, so a public caller cannot spoof it.
 *   When CRON_SECRET is set, the bearer token is required even on Vercel.
 *
 * Responses:
 * - 200 { ok, scanned, expired, released, skipped, errors, wouldExpire, dryRun, results }
 * - 401 when the caller is not authorized
 * - 405 for any method other than GET or POST (this route is not a browser API)
 * - 503 when the Supabase service role client is missing
 * - 500 { error: "Could not expire unpaid holds" }; the detail is logged server-side
 * - ?dry_run=1 reports wouldExpire and does not write or expire a session
 */
import { timingSafeEqual } from 'node:crypto'
import { admin, stripeClient, stripeOk } from '../friendRideLib.js'
import { releaseExpiredUnpaidAirportHolds } from '../abandonedCheckout.js'

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const want = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() !== want) continue
    const raw = headers[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return value == null ? '' : String(value)
  }
  return ''
}

function bearerToken(header) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header || '').trim())
  return match ? match[1] : ''
}

/** Constant-time compare. Different lengths return false without throwing. */
function secretsEqual(presented, expected) {
  const left = Buffer.from(String(presented))
  const right = Buffer.from(String(expected))
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function holdTtlCronAuthorized(req, env = process.env) {
  const secret = String(env?.CRON_SECRET || '').trim()
  const usable = Boolean(secret) && !secret.includes('placeholder')
  const headers = req?.headers || {}
  if (usable && secretsEqual(bearerToken(headerValue(headers, 'authorization')), secret)) return true
  if (usable) return false
  // No usable secret. Trust the platform header only inside Vercel.
  if (!String(env?.VERCEL || '').trim()) return false
  const cron = headerValue(headers, 'x-vercel-cron').trim().toLowerCase()
  return cron === '1' || cron === 'true'
}

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

function dryRunRequested(req) {
  const query = req?.query
  if (query && typeof query === 'object') {
    const raw = query.dry_run ?? query.dryRun
    const value = Array.isArray(raw) ? raw[0] : raw
    if (flagOn(value)) return true
  }
  const url = String(req?.url || '')
  const qIndex = url.indexOf('?')
  if (qIndex === -1) return false
  return flagOn(new URLSearchParams(url.slice(qIndex + 1)).get('dry_run'))
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res, overrides = {}) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }
  const env = overrides.env || process.env
  if (!holdTtlCronAuthorized(req, env)) {
    return sendJson(res, 401, { error: 'Cron authorization required' })
  }
  const sb = Object.prototype.hasOwnProperty.call(overrides, 'sb') ? overrides.sb : admin()
  if (!sb) {
    console.error('[expire-unpaid-airport-holds] service role client unavailable')
    return sendJson(res, 503, { error: 'Service unavailable' })
  }

  const dryRun = dryRunRequested(req)
  const stripe = Object.prototype.hasOwnProperty.call(overrides, 'stripe')
    ? overrides.stripe
    : (stripeOk() ? stripeClient() : null)
  const release = overrides.release || releaseExpiredUnpaidAirportHolds
  try {
    const result = await release(sb, {
      dryRun,
      expireSession: !dryRun && stripe ? (id) => stripe.checkout.sessions.expire(id) : undefined,
      retrieveSession: stripe ? (id) => stripe.checkout.sessions.retrieve(id) : undefined,
    })
    if (!result?.ok) {
      console.error('[expire-unpaid-airport-holds]', result?.error || result?.reason || 'list_failed')
      return sendJson(res, 500, { error: 'Could not expire unpaid holds' })
    }
    return sendJson(res, 200, {
      ok: true,
      scanned: Number(result.scanned) || 0,
      expired: Number(result.expired) || 0,
      released: Number(result.released) || 0,
      skipped: Number(result.skipped) || 0,
      errors: Number(result.errors) || 0,
      wouldExpire: Number(result.wouldExpire) || 0,
      dryRun: Boolean(result.dryRun),
      results: Array.isArray(result.results) ? result.results : [],
    })
  } catch (err) {
    console.error('[expire-unpaid-airport-holds]', err)
    return sendJson(res, 500, { error: 'Could not expire unpaid holds' })
  }
}
