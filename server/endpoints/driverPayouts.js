/**
 * GET  /api/driver-payouts — pending and paid payouts for the signed-in driver
 * POST /api/driver-payouts — retry due payouts (automatic backoff)
 */
import {
  admin, cors, json, userFromAuth, stripeClient,
} from '../friendRideLib.js'
import { attemptDriverPayout, loadConnectAccount, writePayout } from '../payouts.js'
import { payoutIsDue, summarizeDriverEarnings } from '../../shared/paymentFailure.js'

export function cronAuthorized(req, secretOverride) {
  const secret = (secretOverride !== undefined ? secretOverride : (process.env.CRON_SECRET || '')).trim()
  if (!secret || secret.includes('placeholder')) return false
  const header = req.headers?.authorization || req.headers?.Authorization || req.headers?.['AUTHORIZATION'] || ''
  const trimmed = String(header).trim()
  const match = trimmed.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  return match[1].trim() === secret
}

export function isVercelCron(req) {
  return Boolean(
    req.headers?.['x-vercel-cron'] ||
    req.headers?.['X-Vercel-Cron'] ||
    req.headers?.['X-VERCEL-CRON'] ||
    req.headers?.['x-vercel-cron'] === '' ||
    req.headers?.['x-vercel-cron'] === '1'
  )
}

export async function runDuePayouts(sb, trips, connectAccountId, deps = {}) {
  const stripe = deps.stripe !== undefined ? deps.stripe : (deps.stripeClient ? deps.stripeClient() : stripeClient())
  const now = deps.now !== undefined ? deps.now : Date.now()
  const attemptFn = deps.attemptDriverPayout || attemptDriverPayout
  const writeFn = deps.writePayout || writePayout
  const loadAccountFn = deps.loadConnectAccount || loadConnectAccount
  const results = []
  for (const trip of trips) {
    const payout = trip.metadata?.payout
    if (!payout || payout.status === 'paid') continue
    if (!payoutIsDue(payout, now)) continue
    const account = connectAccountId || await loadAccountFn(sb, trip.driver_id)
    const attempt = await attemptFn({ trip, stripe, connectAccountId: account, now })
    await writeFn(sb, trip, attempt.payout)
    results.push({
      tripId: trip.id,
      ok: attempt.ok,
      status: attempt.payout.status,
      lastError: attempt.payout.lastError || null,
      nextRetryAt: attempt.payout.nextRetryAt || null,
      attempts: attempt.payout.attempts || 0,
    })
  }
  return results
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  }

  if (isVercelCron(req)) {
    const isAuth = deps.cronAuthorized ? deps.cronAuthorized(req) : cronAuthorized(req, deps.cronSecret)
    if (!isAuth) {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, 200, { skipped: true, reason: 'Set CRON_SECRET to run scheduled payout retries' })
    }
    const limit = Math.min(Math.max(Number(deps.limit) || 80, 1), 200)
    const listed = await sb
      .from('trips')
      .select('id, driver_id, fare_cents, status, metadata, dropoff_label')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(limit)
    if (listed.error) {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, 500, { error: listed.error.message })
    }
    const results = await runDuePayouts(sb, listed.data || [], null, deps)
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, { ok: true, results })
  }

  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 401, { error: 'Sign in required' })
  }

  const limit = Math.min(Math.max(Number(deps.limit) || 40, 1), 100)
  const listed = await sb
    .from('trips')
    .select('id, driver_id, rider_id, fare_cents, status, metadata, dropoff_label, completed_at')
    .eq('driver_id', user.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit)

  if (listed.error) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 500, { error: listed.error.message })
  }
  const trips = listed.data || []
  const summarize = deps.summarizeDriverEarnings || summarizeDriverEarnings

  if (req.method === 'POST') {
    const loadAccountFn = deps.loadConnectAccount || loadConnectAccount
    const connectAccountId = await loadAccountFn(sb, user.id)
    const results = await runDuePayouts(sb, trips, connectAccountId, deps)
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, { results, summary: summarize(trips) })
  }

  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  return json(res, 200, summarize(trips))
}
