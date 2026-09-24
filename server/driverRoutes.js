/**
 * Driver onboarding handlers served by /api/driver.
 * Response bodies match the previous standalone routes.
 */
import {
  isAdminIdentity,
  blockerLabel,
  legacyStatusFor,
  statusAfterInfoSave,
} from '../shared/driverOnboarding.js'
import { driverQuizError } from '../shared/driverQuiz.js'
import { admin, cors, json, parseBody, userFromAuth } from './friendRideLib.js'
import { loadSubmissionContext, notifyAdminOfApplication } from './driverApproval.js'

export async function handleDriverSignup(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const isStudent = body.isStudent === true
  const hasCar = body.hasCar === true
  const hasInsurance = body.hasInsurance === true
  const wantsExtraMoney = body.wantsExtraMoney === true
  const attestation = body.attestationAccepted === true

  const quizError = driverQuizError({ hasCar, hasInsurance, attestation })
  if (quizError) {
    return json(res, 400, {
      error: quizError,
      code: 'quiz_incomplete',
    })
  }

  const make = String(body.make || '').trim()
  const model = String(body.model || '').trim()
  const plate = String(body.plate || '').trim()
  const color = String(body.color || '').trim() || null
  const fullName = String(body.fullName || user.user_metadata?.full_name || '').trim()
  const phone = String(body.phone || '').trim()
  const seats = Number(body.seats) > 0 ? Math.min(8, Number(body.seats)) : 4

  if (!fullName) return json(res, 400, { error: 'Full name is required' })
  if (phone.replace(/\D/g, '').length < 7) return json(res, 400, { error: 'A real phone number is required' })
  if (!make || !model || !plate) {
    return json(res, 400, { error: 'Vehicle make, model, and plate are required' })
  }

  const email = (user.email || '').toLowerCase()
  const isClemson = email.endsWith('@clemson.edu') || email.endsWith('@g.clemson.edu')
  const now = new Date().toISOString()

  try {
    const { data: existing, error: existingErr } = await sb
      .from('driver_applications')
      .select('onboarding_status')
      .eq('profile_id', user.id)
      .maybeSingle()
    if (existingErr) return json(res, 500, { error: existingErr.message })

    const { data: profileRow, error: profileReadErr } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profileReadErr) return json(res, 500, { error: profileReadErr.message })

    const nextStatus = statusAfterInfoSave(existing?.onboarding_status || null)
    const keepRole = isAdminIdentity({ jwtEmail: email, role: profileRow?.role })

    const profilePatch = {
      id: user.id,
      full_name: fullName,
      phone,
      email: user.email || null,
      updated_at: now,
    }
    if (isClemson) profilePatch.student_verified_at = now
    if (nextStatus === 'approved' && !keepRole) profilePatch.role = 'driver'

    const { error: profileErr } = await sb.from('profiles').upsert(profilePatch)
    if (profileErr) return json(res, 500, { error: profileErr.message })

    const { data: app, error: appErr } = await sb
      .from('driver_applications')
      .upsert(
        {
          profile_id: user.id,
          is_student: isStudent,
          has_car: true,
          has_insurance: true,
          wants_extra_money: wantsExtraMoney,
          attestation_accepted_at: now,
          onboarding_status: nextStatus,
          status: legacyStatusFor(nextStatus),
        },
        { onConflict: 'profile_id' },
      )
      .select('*')
      .single()
    if (appErr) return json(res, 500, { error: appErr.message })

    const { data: existingVeh } = await sb
      .from('vehicles')
      .select('id')
      .eq('driver_id', user.id)
      .limit(1)
    let vehicle = existingVeh?.[0] || null
    const vehFields = {
      make,
      model,
      color,
      plate,
      seats,
      is_tesla: Boolean(body.isTesla),
      autonomous_capable: Boolean(body.isTesla),
      tier: body.isTesla ? 'tesla_self_driving' : 'standard',
    }
    if (!vehicle) {
      const { data: inserted, error: vErr } = await sb
        .from('vehicles')
        .insert({ driver_id: user.id, ...vehFields })
        .select('*')
        .single()
      if (vErr) return json(res, 500, { error: vErr.message })
      vehicle = inserted
    } else {
      const { data: updated, error: vUpErr } = await sb
        .from('vehicles')
        .update(vehFields)
        .eq('id', vehicle.id)
        .select('*')
        .single()
      if (vUpErr) return json(res, 500, { error: vUpErr.message })
      vehicle = updated
    }

    const { error: statusErr } = await sb.from('driver_status').upsert({
      driver_id: user.id,
      online: false,
      updated_at: now,
    })
    if (statusErr) return json(res, 500, { error: statusErr.message })

    if (isClemson) {
      const { error: svErr } = await sb.from('student_verifications').upsert(
        { profile_id: user.id, email, verified_at: now },
        { onConflict: 'profile_id' },
      )
      if (svErr) console.warn('[driver-signup] student_verifications', svErr.message)
    }

    const approved = nextStatus === 'approved'
    return json(res, 200, {
      ok: true,
      application: app,
      onboarding_status: nextStatus,
      approved,
      student_verified: isClemson,
      vehicle,
      message: approved
        ? 'Your driver profile is already approved.'
        : 'Info saved. Upload license, insurance, registration, and car photos next. An admin must approve you before you can receive rides.',
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}

export async function handleDriverSubmitReview(req, res) {
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
