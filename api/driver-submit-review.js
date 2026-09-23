/**
 * POST /api/driver-submit-review
 * Moves a complete application to pending_review and emails john@gmail.com when Resend is configured.
 */
import { legacyStatusFor, blockerLabel } from '../shared/driverOnboarding.js'
import { loadSubmissionContext, notifyAdminOfApplication } from '../server/driverApproval.js'
import {
  admin, cors, json, userFromAuth,
} from '../server/friendRideLib.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { data: app, error: appErr } = await sb
    .from('driver_applications')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (appErr) return json(res, 500, { error: appErr.message })
  if (!app) return json(res, 400, { error: 'Save your driver info before submitting documents.' })
  if (app.onboarding_status === 'approved') {
    return json(res, 200, { ok: true, onboarding_status: 'approved', message: 'Already approved.' })
  }

  const compliance = await loadSubmissionContext(sb, user.id)
  if (compliance.error) return json(res, 500, { error: compliance.error })
  if (compliance.blockers.length) {
    return json(res, 400, {
      error: 'Finish every required step before submitting for review.',
      missing: compliance.blockers,
      missing_labels: compliance.blockers.map(blockerLabel),
    })
  }

  const { data: vehicle } = await sb
    .from('vehicles')
    .select('make, model, color, plate')
    .eq('driver_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!vehicle?.make || !vehicle?.plate) {
    return json(res, 400, { error: 'Add your vehicle before submitting for review.' })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('id, full_name, email, phone')
    .eq('id', user.id)
    .maybeSingle()

  const now = new Date().toISOString()
  const notice = await notifyAdminOfApplication({
    profile: profile || { email: user.email, full_name: user.user_metadata?.full_name },
    vehicle,
  })

  const { data: updated, error: upErr } = await sb
    .from('driver_applications')
    .update({
      onboarding_status: 'pending_review',
      status: legacyStatusFor('pending_review'),
      submitted_at: now,
      admin_notified_at: notice.emailed ? now : null,
      notify_error: notice.emailed ? null : notice.todo,
    })
    .eq('profile_id', user.id)
    .select('*')
    .single()
  if (upErr) return json(res, 500, { error: upErr.message })

  return json(res, 200, {
    ok: true,
    onboarding_status: 'pending_review',
    application: updated,
    emailed: notice.emailed,
    email_todo: notice.emailed ? null : notice.todo,
    message: notice.emailed
      ? 'Submitted. An admin was emailed and will review your documents before you can receive rides.'
      : 'Submitted for admin review. You cannot receive rides until you are approved.',
  })
}
