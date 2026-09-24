/**
 * Driver application thread for the signed-in applicant.
 * GET  /api/driver?action=inbox
 * POST /api/driver?action=inbox  { body }
 */
import { cors, json, parseBody, userFromAuth, admin } from '../friendRideLib.js'

const MISSING = /schema cache|does not exist|could not find the table/i

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  if (req.method === 'GET') return load(sb, res, user.id)

  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { error })
  const text = String(body.body || '').trim()
  if (text.length < 1 || text.length > 4000) return json(res, 400, { error: 'Message must be 1–4000 characters' })

  const inserted = await sb.from('driver_application_messages').insert({
    profile_id: user.id,
    author_id: user.id,
    author_role: 'applicant',
    kind: 'message',
    body: text,
  }).select('id, author_role, kind, body, created_at').single()
  if (inserted.error) {
    if (MISSING.test(inserted.error.message || '')) {
      return json(res, 503, { error: 'Apply supabase/migrations/20260924190000_admin_support.sql' })
    }
    return json(res, 500, { error: inserted.error.message })
  }

  const now = new Date().toISOString()
  await sb.from('driver_info_requests')
    .update({ status: 'fulfilled', fulfilled_at: now })
    .eq('profile_id', user.id)
    .eq('status', 'open')

  await sb.from('admin_notifications').insert({
    kind: 'info_request',
    title: 'Applicant replied',
    body: text.slice(0, 280),
    entity_type: 'driver_application',
    entity_id: user.id,
  })

  const thread = await loadData(sb, user.id)
  return json(res, 200, { ok: true, message: inserted.data, ...thread })
}

async function load(sb, res, profileId) {
  const thread = await loadData(sb, profileId)
  if (thread.error) {
    if (thread.missing) {
      return json(res, 200, { messages: [], requests: [], migrationRequired: true })
    }
    return json(res, 500, { error: thread.error })
  }
  return json(res, 200, thread)
}

async function loadData(sb, profileId) {
  const [messages, requests] = await Promise.all([
    sb.from('driver_application_messages')
      .select('id, author_role, kind, body, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true }),
    sb.from('driver_info_requests')
      .select('id, prompt, status, created_at, fulfilled_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false }),
  ])
  const error = messages.error || requests.error
  if (error) return { error: error.message, missing: MISSING.test(error.message || '') }
  return { messages: messages.data || [], requests: requests.data || [], error: null, missing: false }
}
