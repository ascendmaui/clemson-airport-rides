import { json, parseBody } from './friendRideLib.js'
import { requestClientIp } from './agreementHttp.js'
import { DRIVER_CLICKWRAP_VERSION } from '../shared/driverClickwrap.js'

function cleanOptional(value, max) {
  const text = String(value ?? '').trim()
  if (!text) return null
  return text.slice(0, max)
}

export function publicAcceptance(row) {
  if (!row) return null
  return {
    userId: row.user_id,
    agreementVersion: row.agreement_version,
    acceptedAt: row.accepted_at,
    appVersion: row.app_version ?? null,
    ip: row.ip_address ?? null,
  }
}

export async function loadClickwrap(sb, userId, version = DRIVER_CLICKWRAP_VERSION) {
  const { data, error } = await sb
    .from('driver_clickwrap_acceptances')
    .select('user_id, agreement_version, accepted_at, app_version, ip_address')
    .eq('user_id', userId)
    .eq('agreement_version', version)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function saveClickwrapAcceptance(sb, row) {
  if (!row?.user_id) throw new Error('user id required')
  if (!row.agreement_version) throw new Error('agreement version required')
  if (!row.accepted_at) throw new Error('timestamp required')
  const { data, error } = await sb
    .from('driver_clickwrap_acceptances')
    .upsert(row, { onConflict: 'user_id,agreement_version' })
    .select('user_id, agreement_version, accepted_at, app_version, ip_address')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function handleDriverClickwrap(req, res, { sb, user, now = () => new Date() } = {}) {
  if (!user?.id) return json(res, 401, { error: 'Sign in required' })
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  if (req.method === 'GET') {
    try {
      const row = await loadClickwrap(sb, user.id)
      const acceptance = publicAcceptance(row)
      return json(res, 200, {
        requiredVersion: DRIVER_CLICKWRAP_VERSION,
        accepted: Boolean(acceptance),
        acceptance,
      })
    } catch (err) {
      return json(res, 500, { error: err.message || 'Could not read acceptance' })
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' })
  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })
  const body = parsed.body || {}
  const version = String(body.agreementVersion || body.agreement_version || '').trim()
  if (version !== DRIVER_CLICKWRAP_VERSION) {
    return json(res, 400, { error: 'Agreement version is out of date. Agree to the current Driver Agreement.' })
  }
  const acceptedAt = now().toISOString()
  try {
    const saved = await saveClickwrapAcceptance(sb, {
      user_id: user.id,
      agreement_version: version,
      accepted_at: acceptedAt,
      app_version: cleanOptional(body.appVersion || body.app_version, 40),
      ip_address: cleanOptional(requestClientIp(req), 80),
    })
    return json(res, 200, {
      accepted: true,
      requiredVersion: version,
      acceptance: publicAcceptance(saved),
    })
  } catch (err) {
    return json(res, 500, { error: err.message || 'Could not save acceptance' })
  }
}
