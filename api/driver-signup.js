/**
 * POST /api/driver-signup
 * Student driver quiz → driver_applications + profiles.role=driver + vehicles + driver_status.
 * Soft-verify @clemson.edu → student_verified_at (open signup — other emails not blocked).
 * Self-contained (does not import friendRideLib).
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(body))
}

function cors(req, res) {
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return true
  }
  return false
}

function parseBody(req) {
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return { error: 'Invalid JSON' }
    }
  }
  return { body: body || {} }
}

function admin() {
  if (!serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function userFromAuth(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  const m = String(h).match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const sb = admin()
  if (!sb) return null
  const { data, error } = await sb.auth.getUser(m[1])
  if (error || !data?.user) return null
  return data.user
}

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
  const fullName = String(body.fullName || user.user_metadata?.full_name || '').trim() || null
  const phone = String(body.phone || '').trim() || null
  const seats = Number(body.seats) > 0 ? Number(body.seats) : 4

  if (!make || !model || !plate) {
    return json(res, 400, { error: 'Vehicle make, model, and plate are required' })
  }

  const email = (user.email || '').toLowerCase()
  const isClemson = email.endsWith('@clemson.edu')
  const now = new Date().toISOString()

  try {
    const profilePatch = {
      id: user.id,
      role: 'driver',
      full_name: fullName,
      phone,
      email: user.email || null,
      updated_at: now,
    }
    if (isClemson) profilePatch.student_verified_at = now

    const { error: profileErr } = await sb.from('profiles').upsert(profilePatch)
    if (profileErr) return json(res, 500, { error: profileErr.message })

    const { data: app, error: appErr } = await sb
      .from('driver_applications')
      .insert({
        profile_id: user.id,
        is_student: true,
        has_car: true,
        has_insurance: true,
        wants_extra_money: true,
        attestation_accepted_at: now,
        status: 'approved',
        reviewed_at: now,
      })
      .select('*')
      .single()
    if (appErr) return json(res, 500, { error: appErr.message })

    const { data: existingVeh } = await sb
      .from('vehicles')
      .select('id')
      .eq('driver_id', user.id)
      .limit(1)
    let vehicle = existingVeh?.[0] || null
    if (!vehicle) {
      const { data: inserted, error: vErr } = await sb
        .from('vehicles')
        .insert({
          driver_id: user.id,
          make,
          model,
          color,
          plate,
          seats,
          is_tesla: Boolean(body.isTesla),
          autonomous_capable: Boolean(body.isTesla),
          tier: body.isTesla ? 'tesla_self_driving' : 'standard',
        })
        .select('*')
        .single()
      if (vErr) return json(res, 500, { error: vErr.message })
      vehicle = inserted
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

    return json(res, 200, {
      ok: true,
      application: app,
      role: 'driver',
      student_verified: isClemson,
      vehicle,
      message: isClemson
        ? 'Approved as Clemson student driver'
        : 'Approved as driver (open signup — verify Clemson email later for student badge)',
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
