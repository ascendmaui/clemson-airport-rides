/**
 * GET  /api/driver-payouts — pending and paid payouts for the signed-in driver
 * POST /api/driver-payouts — retry due payouts (automatic backoff)
 * Cron: Authorization Bearer CRON_SECRET.
 * On Vercel the sweep runs only when that bearer matches and the request
 * carries a platform cron signal: legacy x-vercel-cron, the documented
 * user-agent vercel-cron/1.0, or x-vercel-cron-schedule
 * (https://vercel.com/docs/cron-jobs). A signal with a missing or wrong
 * bearer returns { skipped: true } and does not move money. Off Vercel
 * (VERCEL unset) the bearer alone runs the sweep; spoofed cron headers and
 * the Vercel user-agent are ignored. ?dry_run=1 still requires the bearer
 * and does not call Stripe or write rows.
 * DISABLE_CRON_ENDPOINTS=1 refuses the sweep and a signed-in retry POST.
 * Dry-run of the sweep is allowed only when ALLOW_STAGING_DRY_RUN=1.
 */
import {
  admin, cors, json, userFromAuth, stripeClient,
} from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { attemptDriverPayout, attemptStandbyBackupPayout, loadConnectAccount, writePayout } from '../payouts.js'
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

/** Documented Vercel Cron user-agent. https://vercel.com/docs/cron-jobs */
const VERCEL_CRON_USER_AGENT = 'vercel-cron/1.0'

function matchingHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined
  const want = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() !== want) continue
    const raw = headers[key]
    return Array.isArray(raw) ? raw[0] : raw
  }
  return undefined
}

function headerText(headers, name) {
  const raw = matchingHeader(headers, name)
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  if (raw == null) return ''
  return String(raw)
}

/**
 * True when the request looks like a Vercel Cron invocation.
 * Does not authorize money movement. The handler still requires a matching
 * CRON_SECRET bearer, and ignores this signal when VERCEL is unset.
 *
 * Signals, any one of them:
 * - x-vercel-cron (legacy; any present value, including an empty string)
 * - user-agent containing vercel-cron/1.0 (current Vercel docs)
 * - x-vercel-cron-schedule with a non-empty cron expression (current Vercel docs)
 */
export function isVercelCron(req) {
  const headers = req?.headers
  if (matchingHeader(headers, 'x-vercel-cron') !== undefined) return true
  if (headerText(headers, 'x-vercel-cron-schedule').trim()) return true
  return headerText(headers, 'user-agent').toLowerCase().includes(VERCEL_CRON_USER_AGENT)
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
  async function recordStandby(trip, dryRun) {
    const standby = await (deps.attemptStandbyBackupPayout || attemptStandbyBackupPayout)({
      sb,
      trip,
      stripe: dryRun ? null : stripe,
      now,
      dryRun,
    })
    if (!standby?.payout || standby.idempotent) return
    results.push({
      tripId: trip.id,
      role: 'standby',
      ok: standby.ok !== false,
      dryRun: Boolean(dryRun),
      status: standby.payout.status || null,
      amountCents: standby.payout.amountCents ?? null,
      driverId: standby.payout.driverId || null,
      wouldTransfer: dryRun ? standby.payout.amountCents > 0 : undefined,
    })
  }

  for (const trip of trips) {
    const payout = trip.metadata?.payout
    if (!payout || payout.status === 'paid' || !payoutIsDue(payout, now)) {
      await recordStandby(trip, Boolean(deps.dryRun))
      continue
    }
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
      await recordStandby(trip, true)
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
    await recordStandby(trip, false)
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
  // On Vercel a platform signal selects the cron path (legacy x-vercel-cron,
  // user-agent vercel-cron/1.0, or x-vercel-cron-schedule). The bearer must
  // still match. Off Vercel (VERCEL unset) the bearer alone is enough.
  // Spoofed cron headers and the Vercel user-agent are ignored when VERCEL is unset.
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
