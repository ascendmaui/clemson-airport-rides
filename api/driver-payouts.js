/**
 * GET  /api/driver-payouts — pending and paid payouts for the signed-in driver
 * POST /api/driver-payouts — retry due payouts (automatic backoff)
 */
import {
  admin, cors, json, userFromAuth, stripeClient,
} from '../server/friendRideLib.js'
import { attemptDriverPayout, loadConnectAccount, writePayout } from '../server/payouts.js'
import { payoutIsDue, summarizeDriverEarnings } from '../shared/paymentFailure.js'

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret || secret.includes('placeholder')) return false
  const header = req.headers.authorization || req.headers.Authorization || ''
  return header === `Bearer ${secret}`
}

async function runDuePayouts(sb, trips, connectAccountId) {
  const stripe = stripeClient()
  const now = Date.now()
  const results = []
  for (const trip of trips) {
    const payout = trip.metadata?.payout
    if (!payout || payout.status === 'paid') continue
    if (!payoutIsDue(payout, now)) continue
    const account = connectAccountId || await loadConnectAccount(sb, trip.driver_id)
    const attempt = await attemptDriverPayout({ trip, stripe, connectAccountId: account, now })
    await writePayout(sb, trip, attempt.payout)
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

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  if (req.headers['x-vercel-cron']) {
    if (!cronAuthorized(req)) {
      return json(res, 200, { skipped: true, reason: 'Set CRON_SECRET to run scheduled payout retries' })
    }
    const listed = await sb
      .from('trips')
      .select('id, driver_id, fare_cents, status, metadata, dropoff_label')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(80)
    if (listed.error) return json(res, 500, { error: listed.error.message })
    const results = await runDuePayouts(sb, listed.data || [], null)
    return json(res, 200, { ok: true, results })
  }

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const listed = await sb
    .from('trips')
    .select('id, driver_id, rider_id, fare_cents, status, metadata, dropoff_label, completed_at')
    .eq('driver_id', user.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(40)

  if (listed.error) return json(res, 500, { error: listed.error.message })
  const trips = listed.data || []

  if (req.method === 'POST') {
    const connectAccountId = await loadConnectAccount(sb, user.id)
    const results = await runDuePayouts(sb, trips, connectAccountId)
    return json(res, 200, { results, summary: summarizeDriverEarnings(trips) })
  }

  return json(res, 200, summarizeDriverEarnings(trips))
}
