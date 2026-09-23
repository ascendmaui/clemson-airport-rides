/**
 * POST /api/driver-signup
 * Saves driver quiz + vehicle. Never auto-approves.
 * onboarding_status becomes pending_docs (or stays approved / pending_review).
 */
import {
  ADMIN_EMAIL,
  legacyStatusFor,
  statusAfterInfoSave,
} from '../shared/driverOnboarding.js'
import {
  admin, cors, json, parseBody, userFromAuth,
} from '../server/friendRideLib.js'

export default async function handler(req, res) {
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

  if (!isStudent || !hasCar || !hasInsurance || !wantsExtraMoney || !attestation) {
    return json(res, 400, {
      error: 'All quiz answers must be Yes and attestation accepted',
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
    const keepRole = profileRow?.role === 'admin' || profileRow?.role === 'ops' || email === ADMIN_EMAIL

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
          is_student: true,
          has_car: true,
          has_insurance: true,
          wants_extra_money: true,
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
