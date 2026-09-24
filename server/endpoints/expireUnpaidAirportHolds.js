/**
 * GET or POST /api/expire-unpaid-airport-holds
 *
 * Cancels unpaid airport-deposit searching, offered, and scheduled holds
 * older than 20 minutes (UNPAID_AIRPORT_HOLD_TTL_MS). The age anchor is the
 * later of trips.created_at and metadata.stripe_checkout_created_at. The
 * cancel reuses abandonedCheckout: status canceled, checkout_abandoned
 * stamped, and a trip_events row with reason unpaid_hold_ttl. A later paid
 * deposit webhook restores the trip the same way as Checkout abandon.
 *
 * No new secret. Invoke about every 15 minutes. Add this object to the
 * crons array in vercel.json (the schedule is asterisk-slash-15, then an
 * asterisk for hour, day, month, and weekday):
 *
 *   path: /api/expire-unpaid-airport-holds
 *   schedule: every 15 minutes
 *
 * Hobby cron jobs run at most once a day, which is slower than this TTL, so
 * use a plan that allows a 15-minute schedule (or call this path from another
 * tick that already runs that often).
 *
 * Authorization:
 * - If CRON_SECRET is already set for driver payouts, send
 *   Authorization: Bearer $CRON_SECRET. Vercel Cron does this when that env
 *   var exists. A spoofed x-vercel-cron header is not enough.
 * - If CRON_SECRET is unset, x-vercel-cron: 1 is enough. That header is what
 *   Vercel sends on a cron invocation.
 */
import { admin, cors, json, stripeClient, stripeOk } from '../friendRideLib.js'
import { releaseExpiredUnpaidAirportHolds } from '../abandonedCheckout.js'

export function holdTtlCronAuthorized(req, env = process.env) {
  const secret = String(env?.CRON_SECRET || '')
  const usable = Boolean(secret) && !secret.includes('placeholder')
  const headers = req?.headers || {}
  const header = headers.authorization || headers.Authorization || ''
  if (usable && header === `Bearer ${secret}`) return true
  if (usable) return false
  const cron = headers['x-vercel-cron'] ?? headers['X-Vercel-Cron']
  return cron === '1' || cron === 'true' || cron === true
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  if (!holdTtlCronAuthorized(req)) {
    return json(res, 401, { error: 'Cron authorization required' })
  }
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const stripe = stripeOk() ? stripeClient() : null
  try {
    const result = await releaseExpiredUnpaidAirportHolds(sb, {
      expireSession: stripe ? (id) => stripe.checkout.sessions.expire(id) : undefined,
      retrieveSession: stripe ? (id) => stripe.checkout.sessions.retrieve(id) : undefined,
    })
    if (!result.ok) return json(res, 500, { error: result.error || 'Could not expire unpaid holds' })
    return json(res, 200, result)
  } catch (err) {
    return json(res, 500, { error: err.message || 'Could not expire unpaid holds' })
  }
}
