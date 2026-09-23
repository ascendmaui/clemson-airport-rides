/**
 * POST /api/support-ticket  — file a confirmed ticket
 * GET  /api/support-ticket  — list the signed-in user's tickets
 * Admin list: SUPPORT_ADMIN_EMAILS (default john@gmail.com) sees every ticket.
 */
import { adminClient, userFromAuth } from '../supabaseAdmin.js'
import { cors, json, parseBody, rateLimit } from '../agentHttp.js'
import { validateTicket } from '../supportAgent.js'
import { loadUserContext, resolveRoleVariant } from '../userContext.js'
import { redactPeerText } from '../privacyName.js'

const MISSING_TABLE = /support_tickets|schema cache|does not exist/i

function adminEmails() {
  return (process.env.SUPPORT_ADMIN_EMAILS || 'john@gmail.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

function isAdmin(user) {
  return adminEmails().includes(String(user?.email || '').toLowerCase())
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = adminClient()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' })

  const user = await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  if (req.method === 'GET') {
    let query = sb
      .from('support_tickets')
      .select('id, user_id, role_variant, category, subject, body, status, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    if (!isAdmin(user)) query = query.eq('user_id', user.id)
    const { data, error } = await query
    if (error) {
      if (MISSING_TABLE.test(error.message || '')) {
        return json(res, 503, {
          error: 'Support tickets are not in the database yet. Apply supabase/migrations/20260923120000_support_tickets.sql.',
          tickets: [],
        })
      }
      return json(res, 500, { error: 'Could not load tickets.' })
    }
    let viewer = { signedIn: true }
    try { viewer = await loadUserContext(sb, user) } catch { /* list without extra redaction context */ }
    const tickets = (data || []).map((ticket) => ({
      ...ticket,
      subject: redactPeerText(ticket.subject, viewer),
      body: redactPeerText(ticket.body, viewer),
    }))
    return json(res, 200, { tickets, isAdmin: isAdmin(user) })
  }

  if (!rateLimit(req, { bucket: 'ticket', userId: user.id, limit: 5, windowMs: 10 * 60_000 })) {
    return json(res, 429, { error: 'Too many tickets. Wait a few minutes or email rides@clemson.edu.' })
  }

  const { body, error: parseError } = parseBody(req)
  if (parseError) return json(res, 400, { error: parseError })

  let context = { signedIn: true, role: 'rider' }
  try {
    context = await loadUserContext(sb, user)
  } catch (err) {
    console.error('[support-ticket] context', err?.message || err)
  }
  const roleVariant = resolveRoleVariant(context, body.roleVariant)
  const checked = validateTicket({
    ...body,
    roleVariant,
    confirmed: body.confirmed === true,
    subject: redactPeerText(body.subject, context),
    body: redactPeerText(body.body, context),
  })
  if (!checked.ok) return json(res, 400, { error: checked.error })

  const metadata = {
    source: 'support-agent',
    role: context.role || 'rider',
    hasCard: Boolean(context.billing?.hasCard),
    studentVerified: Boolean(context.student?.verified),
    latestTripStatus: context.recentTrips?.[0]?.status || null,
  }

  const { data, error } = await sb
    .from('support_tickets')
    .insert({
      user_id: user.id,
      role_variant: checked.ticket.roleVariant,
      category: checked.ticket.category,
      subject: checked.ticket.subject,
      body: checked.ticket.body,
      status: 'open',
      metadata,
    })
    .select('id, status, category, subject, created_at')
    .single()

  if (error) {
    if (MISSING_TABLE.test(error.message || '')) {
      return json(res, 503, {
        error: 'Support tickets are not in the database yet. Apply supabase/migrations/20260923120000_support_tickets.sql, or email rides@clemson.edu.',
      })
    }
    if (/foreign key|profiles/i.test(error.message || '')) {
      return json(res, 409, { error: 'Open Account once so your profile exists, then file the ticket again.' })
    }
    console.error('[support-ticket]', error.message)
    return json(res, 500, { error: 'Could not file the ticket.' })
  }

  return json(res, 200, { ticket: data })
}
