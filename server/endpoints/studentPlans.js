/**
 * /api/stripe-payment-methods?action=student-plans
 * Rider ops (POST, signed in, feature flag on for this rider):
 *   status, otp-request, otp-verify, subscribe, pause, resume, cancel
 * Admin ops: admin-pending, admin-review (manual registrar approval)
 * Public: GET op=unsubscribe&token=...
 * Cron: op=nightly with Bearer CRON_SECRET. No-ops while the flag is off.
 *   ?dry_run=1 computes quotes without writing. Email sending is disabled.
 */
import { admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, ensureStripeCustomer } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { cronAuthorized } from './driverPayouts.js'
import { studentPlansEnabled } from '../../shared/studentPlans.js'
import { resolveLanguageModel } from '../llm.js'
import { runNightlyQuotes } from '../studentPlanQuotes.js'
import {
  adminReviewEnrollment, cancelStudentPlan, listPendingEnrollments, loadStudentPlanStatus, pauseStudentPlan,
  requestStudentOtp, resumeStudentPlan, subscribeStudentPlan, unsubscribePlanEmails, verifyStudentOtp,
} from '../studentPlans.js'

function queryParam(req, name) {
  const q = req?.query
  if (q && typeof q === 'object' && q[name] != null) return String(Array.isArray(q[name]) ? q[name][0] : q[name])
  const url = String(req?.url || '')
  const i = url.indexOf('?')
  return i === -1 ? null : new URLSearchParams(url.slice(i + 1)).get(name)
}

function flagOn(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true'
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const env = deps.env || process.env
  const now = deps.now instanceof Date ? deps.now : new Date()
  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body || {}
  }
  const op = String(body.op || queryParam(req, 'op') || 'status')
  const sb = deps.sb !== undefined ? deps.sb : admin()

  if (op === 'unsubscribe') {
    if (!sb) return json(res, 503, { error: 'unavailable' })
    const out = await unsubscribePlanEmails(sb, queryParam(req, 'token') || body.token)
    if (req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:32px"><h2 style="color:#F56600">Clemson Rides</h2><p>${out.ok ? 'You are unsubscribed from student plan emails.' : 'That link is no longer valid.'}</p></body>`)
    }
    return json(res, 200, out)
  }

  if (op === 'nightly') {
    const authorized = deps.cronAuthorized ? deps.cronAuthorized(req) : cronAuthorized(req)
    if (!authorized) return json(res, 401, { error: 'Unauthorized' })
    const dryRun = flagOn(queryParam(req, 'dry_run')) || body.dryRun === true
    const block = stagingCronBlock(env, { dryRun })
    if (block) return json(res, block.status, block.body)
    if (!studentPlansEnabled(env) && !dryRun) return json(res, 200, { ok: true, skipped: true, reason: 'feature_flag_off' })
    if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    try {
      const out = await (deps.runNightlyQuotes || runNightlyQuotes)(sb, { now, env, dryRun, deps: { resolveLanguageModel } })
      return json(res, 200, { ok: true, ...out, previews: dryRun ? out.previews.length : undefined })
    } catch (error) {
      return json(res, 500, { error: error?.message || 'nightly failed' })
    }
  }

  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  if (!studentPlansEnabled(env, user)) return json(res, 200, { enabled: false })

  const stripe = deps.stripe !== undefined ? deps.stripe : (stripeOk() ? stripeClient() : null)
  try {
    switch (op) {
      case 'status': return json(res, 200, await loadStudentPlanStatus(sb, user, { now, env }))
      case 'otp-request': return json(res, 200, await requestStudentOtp(sb, user, { now, env, send: deps.sendOtp }))
      case 'otp-verify': return json(res, 200, await verifyStudentOtp(sb, user, body.code, { now, env }))
      case 'subscribe': return json(res, 200, await subscribeStudentPlan(sb, user, body, { stripe, now, env, ensureStripeCustomer: deps.ensureStripeCustomer || ensureStripeCustomer }))
      case 'pause': return json(res, 200, await pauseStudentPlan(sb, user, body, { stripe, now, env }))
      case 'resume': return json(res, 200, await resumeStudentPlan(sb, user, { stripe, now }))
      case 'cancel': return json(res, 200, await cancelStudentPlan(sb, user, { stripe, now }))
      case 'admin-pending': return json(res, 200, { pending: await listPendingEnrollments(sb, user, { now }) })
      case 'admin-review': return json(res, 200, await adminReviewEnrollment(sb, user, { riderId: body.riderId, approve: body.approve === true, term: body.term }, { now }))
      default: return json(res, 400, { error: 'Unknown student plan op' })
    }
  } catch (error) {
    return json(res, error?.status || 500, { error: error?.message || 'Student plan error', code: error?.code })
  }
}
