/**
 * GET  /api/driver-payouts — pending and paid payouts for the signed-in driver
 * POST /api/driver-payouts — retry due payouts (automatic backoff)
 * Cron: Authorization Bearer CRON_SECRET. On Vercel, x-vercel-cron is also
 * required. Off Vercel the bearer alone runs the sweep. ?dry_run=1 computes
 * due payouts and does not call Stripe or write rows. Bearer still required.
 * DISABLE_CRON_ENDPOINTS=1 refuses the sweep and a signed-in retry POST.
 * Dry-run of the sweep is allowed only when ALLOW_STAGING_DRY_RUN=1.
 */
import {
  admin, cors, json, userFromAuth, stripeClient,
} from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { attemptDriverPayout, loadConnectAccount, writePayout } from '../payouts.js'
import { payoutIsDue, resolveDriverNetCents, summarizeDriverEarnings } from '../../shared/paymentFailure.js'

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

function runtimeEnv(deps) {
  return deps?.env || process.env
}

/** True only when the process is actually running on Vercel. Unset off the VPS. */
export function runningOnVercel(env = process.env) {
  return Boolean(String(env?.VERCEL || '').trim())
}

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

/** Cron dry-run. Bearer is still required by the caller. Does not move money. */
export function payoutDryRunRequested(req) {
  const query = req?.query
  if (query && typeof query === 'object') {
    const raw = query.dry_run ?? query.dryRun
    const value = Array.isArray(raw) ? raw[0] : raw
    if (flagOn(value)) return true
  }
  const url = String(req?.url || '')
  const qIndex = url.indexOf('?')
  if (qIndex === -1) return false
  const params = new URLSearchParams(url.slice(qIndex + 1))
  return flagOn(params.get('dry_run') ?? params.get('dryRun'))
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
    if (deps.dryRun) {
      const rawAmount = payout.amountCents
      const amountCents = rawAmount == null || rawAmount === ''
        ? resolveDriverNetCents(trip)
        : Math.max(0, Math.round(Number(rawAmount) || 0))
      results.push({
        tripId: trip.id,
        ok: true,
        dryRun: true,
        status: payout.status,
        amountCents,
        wouldTransfer: amountCents > 0,
        lastError: null,
        nextRetryAt: payout.nextRetryAt || null,
        attempts: payout.attempts || 0,
      })
      continue
    }
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

  const env = runtimeEnv(deps)
  const secretArg = deps.cronSecret !== undefined ? deps.cronSecret : env.CRON_SECRET
  const bearerOk = deps.cronAuthorized ? deps.cronAuthorized(req) : cronAuthorized(req, secretArg)
  const onVercel = runningOnVercel(env)
  // On Vercel the platform header selects the cron path, and the bearer must
  // still match. Off Vercel (VERCEL unset) the bearer alone is enough, matching
  // hold-expiry. A spoofed x-vercel-cron header is ignored when VERCEL is unset.
  const cronPath = (onVercel && isVercelCron(req)) || (!onVercel && bearerOk)
  if (cronPath) {
    if (!bearerOk) {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, 200, { skipped: true, reason: 'Set CRON_SECRET to run scheduled payout retries' })
    }
    const dryRun = payoutDryRunRequested(req) || deps.dryRun === true
    const blocked = stagingCronBlock(env, { dryRun })
    if (blocked) {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, blocked.status, blocked.body)
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
    const results = await runDuePayouts(sb, listed.data || [], null, { ...deps, dryRun })
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, dryRun ? { ok: true, dryRun: true, results } : { ok: true, results })
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
    const blocked = stagingCronBlock(env, { dryRun: false })
    if (blocked) {
      res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      return json(res, blocked.status, blocked.body)
    }
    const loadAccountFn = deps.loadConnectAccount || loadConnectAccount
    const connectAccountId = await loadAccountFn(sb, user.id)
    const results = await runDuePayouts(sb, trips, connectAccountId, deps)
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, { results, summary: summarize(trips) })
  }

  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  return json(res, 200, summarize(trips))
}
