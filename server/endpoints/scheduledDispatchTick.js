/**
 * GET or POST /api/scheduled-dispatch-tick
 * Minute job for the backup-driver confirm window. Idempotent.
 * Cron: Authorization Bearer CRON_SECRET. On Vercel a platform cron signal
 * is also required. Off Vercel the bearer alone runs the tick.
 * DISABLE_CRON_ENDPOINTS=1 refuses the tick. Dry-run is allowed only when
 * ALLOW_STAGING_DRY_RUN=1.
 */
import { admin, cors, json } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import {
  cronAuthorized,
  isVercelCron,
  payoutDryRunRequested,
  runningOnVercel,
} from './driverPayouts.js'
import { runScheduledDispatchTick } from '../backupDriverDispatch.js'
import { sweepStaleTrips } from '../staleTripSweep.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const env = deps.env || process.env
  const secretArg = deps.cronSecret !== undefined ? deps.cronSecret : env.CRON_SECRET
  const bearerOk = deps.cronAuthorized ? deps.cronAuthorized(req) : cronAuthorized(req, secretArg)
  const onVercel = runningOnVercel(env)
  const cronPath = (onVercel && isVercelCron(req)) || (!onVercel && bearerOk)
  if (!cronPath || !bearerOk) {
    return json(res, 401, { error: 'Cron authorization required' })
  }
  const dryRun = payoutDryRunRequested(req) || deps.dryRun === true
  const blocked = stagingCronBlock(env, { dryRun })
  if (blocked) return json(res, blocked.status, blocked.body)
  try {
    const now = deps.now ? new Date(deps.now) : new Date()
    const summary = await runScheduledDispatchTick(sb, {
      now,
      dryRun,
      limit: deps.limit,
    })
    let staleTrips = null
    try {
      staleTrips = await sweepStaleTrips(sb, { now, dryRun, stripe: deps.stripe })
    } catch (error) {
      console.error('[scheduled-dispatch-tick] stale trips', error?.message || error)
      staleTrips = { error: 'stale_sweep_failed' }
    }
    return json(res, 200, { ok: true, dryRun, ...summary, staleTrips })
  } catch (error) {
    console.error('[scheduled-dispatch-tick]', error?.message || error)
    return json(res, 500, { error: error?.message || 'Dispatch tick failed' })
  }
}
