/**
 * Admin dashboard API. Service role reads after an admin check.
 * Support staff cannot call this — driver documents and rider PII stay admin-only.
 *
 * GET  /api/admin?action=overview|notifications|people|trips|tickets|applicant-thread
 * POST /api/admin?action=mark-notification|ticket-reply|applicant-message|info-request
 */
import { isTicketStatus } from '../../shared/adminAccess.js'
import { cors, json, parseBody, userFromAuth, admin } from '../friendRideLib.js'
import { resolveRouteAction } from '../routeAction.js'
import { loadStaffAccess } from '../staffAccess.js'
import { sendApplicantNotice } from '../applicantMail.js'

const ACTIONS = [
  'overview',
  'notifications',
  'people',
  'trips',
  'tickets',
  'applicant-thread',
  'mark-notification',
  'ticket-reply',
  'applicant-message',
  'info-request',
]

const GET_ACTIONS = new Set([
  'overview',
  'notifications',
  'people',
  'trips',
  'tickets',
  'applicant-thread',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING = /schema cache|does not exist|could not find the table/i

function isUuid(value) {
  return UUID.test(String(value || ''))
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: ACTIONS })
  if (!action) {
    return json(res, 400, {
      error: 'Unknown admin action. Use overview, notifications, people, trips, tickets, applicant-thread, mark-notification, ticket-reply, applicant-message, or info-request.',
    })
  }
  const expectsGet = GET_ACTIONS.has(action)
  if (expectsGet && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
  if (!expectsGet && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const access = await loadStaffAccess(sb, user)
  if (!access.admin) return json(res, 403, { error: 'Admin only' })

  const url = new URL(req.url || '/', 'http://localhost')
  if (req.method === 'GET') return read(sb, res, action, url)
  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { error })
  return write(sb, res, action, user, body)
}

async function read(sb, res, action, url) {
  switch (action) {
    case 'overview':
      return overview(sb, res)
    case 'notifications':
      return notifications(sb, res)
    case 'people':
      return people(sb, res, url.searchParams.get('role') || '')
    case 'trips':
      return trips(sb, res, url.searchParams.get('status') || '')
    case 'tickets':
      return tickets(sb, res, url.searchParams.get('status') || '', url.searchParams.get('id') || '')
    case 'applicant-thread':
      return applicantThread(sb, res, url.searchParams.get('profile_id') || '')
    default: {
      const unknown = action
      return json(res, 400, { error: `Unknown admin read: ${unknown}` })
    }
  }
}

async function write(sb, res, action, user, body) {
  switch (action) {
    case 'mark-notification':
      return markNotification(sb, res, body)
    case 'ticket-reply':
      return ticketReply(sb, res, user, body)
    case 'applicant-message':
      return applicantMessage(sb, res, user, body)
    case 'info-request':
      return infoRequest(sb, res, user, body)
    default: {
      const unknown = action
      return json(res, 400, { error: `Unknown admin write: ${unknown}` })
    }
  }
}

async function safeCount(sb, table, column, value) {
  let query = sb.from(table).select('id', { count: 'exact', head: true })
  if (column && value) query = query.eq(column, value)
  const { count, error } = await query
  if (error) return { count: 0, missing: MISSING.test(error.message || ''), error: error.message }
  return { count: count || 0, missing: false, error: null }
}

async function overview(sb, res) {
  const [pending, unread, escalated, activeTickets] = await Promise.all([
    safeCount(sb, 'driver_applications', 'onboarding_status', 'pending_review'),
    sb.from('admin_notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    safeCount(sb, 'support_tickets', 'status', 'escalated'),
    sb.from('support_tickets').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
  ])
  const unreadMissing = Boolean(unread.error && MISSING.test(unread.error.message || ''))
  const ticketsMissing = Boolean(activeTickets.error && MISSING.test(activeTickets.error.message || ''))
  return json(res, 200, {
    pendingApplications: pending.count,
    unreadNotifications: unread.error ? 0 : (unread.count || 0),
    escalatedTickets: escalated.count,
    activeTickets: activeTickets.error ? 0 : (activeTickets.count || 0),
    migrationRequired: pending.missing || unreadMissing || ticketsMissing || escalated.missing,
    inbox: 'support_tickets',
  })
}

async function notifications(sb, res) {
  const { data, error } = await sb
    .from('admin_notifications')
    .select('id, kind, title, body, entity_type, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    if (MISSING.test(error.message || '')) {
      return json(res, 200, {
        notifications: [],
        migrationRequired: true,
        error: 'Apply supabase/migrations/20260924190000_admin_support.sql',
      })
    }
    return json(res, 500, { error: error.message })
  }
  return json(res, 200, { notifications: data || [] })
}

async function people(sb, res, role) {
  const columns = 'id, full_name, email, phone, role, is_admin, rating_avg, rating_count, standing'
  let query = sb.from('profiles').select(columns).order('full_name', { ascending: true }).limit(80)
  if (role && role !== 'all') query = query.eq('role', role)
  let result = await query
  if (result.error && /standing|column|schema/i.test(result.error.message || '')) {
    query = sb.from('profiles').select('id, full_name, email, phone, role, is_admin').limit(80)
    if (role && role !== 'all') query = query.eq('role', role)
    result = await query
  }
  if (result.error) return json(res, 500, { error: result.error.message })
  return json(res, 200, { people: result.data || [] })
}

async function trips(sb, res, status) {
  const columns = 'id, status, rider_id, driver_id, pickup_label, dropoff_label, fare_cents, tier, passengers'
  let query = sb.from('trips').select(columns).limit(40)
  if (status) query = query.eq('status', status)
  let result = await query
  if (result.error && /column|schema/i.test(result.error.message || '')) {
    query = sb.from('trips').select('id, status, rider_id, driver_id, pickup_label, dropoff_label').limit(40)
    if (status) query = query.eq('status', status)
    result = await query
  }
  if (result.error) return json(res, 500, { error: result.error.message })
  const rows = result.data || []
  const ids = [...new Set(rows.flatMap((row) => [row.rider_id, row.driver_id]).filter(Boolean))]
  let names = {}
  if (ids.length) {
    const profiles = await sb.from('profiles').select('id, full_name, email').in('id', ids)
    names = Object.fromEntries((profiles.data || []).map((row) => [row.id, row]))
  }
  return json(res, 200, {
    trips: rows.map((row) => ({
      ...row,
      rider: names[row.rider_id] || null,
      driver: names[row.driver_id] || null,
    })),
  })
}

async function tickets(sb, res, status, id) {
  if (id) {
    if (!isUuid(id)) return json(res, 400, { error: 'Ticket id must be a uuid' })
    const ticket = await sb
      .from('support_tickets')
      .select('id, user_id, role_variant, category, subject, body, status, bot_intent, bot_confidence, escalation_reason, created_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    if (ticket.error) return ticketError(res, ticket.error)
    if (!ticket.data) return json(res, 404, { error: 'Ticket not found' })
    const [messages, profile] = await Promise.all([
      sb.from('support_ticket_messages').select('id, author_role, body, created_at').eq('ticket_id', id).order('created_at', { ascending: true }),
      sb.from('profiles').select('id, full_name, email, phone, role').eq('id', ticket.data.user_id).maybeSingle(),
    ])
    return json(res, 200, {
      ticket: ticket.data,
      messages: messages.error ? [] : (messages.data || []),
      profile: profile.data || null,
    })
  }

  let query = sb
    .from('support_tickets')
    .select('id, user_id, role_variant, category, subject, status, bot_intent, bot_confidence, escalation_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error && /column|schema cache/i.test(error.message || '') && !MISSING.test(error.message || '')) {
    let fallback = sb.from('support_tickets').select('id, user_id, role_variant, category, subject, status, created_at').order('created_at', { ascending: false }).limit(50)
    if (status) fallback = fallback.eq('status', status)
    const retry = await fallback
    if (retry.error) return ticketError(res, retry.error)
    return json(res, 200, { tickets: retry.data || [] })
  }
  if (error) return ticketError(res, error)
  return json(res, 200, { tickets: data || [] })
}

function ticketError(res, error) {
  if (MISSING.test(error.message || '')) {
    return json(res, 200, {
      tickets: [],
      migrationRequired: true,
      error: 'Apply supabase/migrations/20260924190000_admin_support.sql',
    })
  }
  return json(res, 500, { error: error.message })
}

async function applicantThread(sb, res, profileId) {
  if (!isUuid(profileId)) return json(res, 400, { error: 'profile_id must be a uuid' })
  const [messages, requests] = await Promise.all([
    sb.from('driver_application_messages').select('id, author_role, kind, body, email_stub, created_at').eq('profile_id', profileId).order('created_at', { ascending: true }),
    sb.from('driver_info_requests').select('id, prompt, status, email_stub, emailed_at, created_at, fulfilled_at').eq('profile_id', profileId).order('created_at', { ascending: false }),
  ])
  const missing = [messages.error, requests.error].find((error) => error && MISSING.test(error.message || ''))
  if (missing) {
    return json(res, 200, {
      messages: [],
      requests: [],
      migrationRequired: true,
      error: 'Apply supabase/migrations/20260924190000_admin_support.sql',
    })
  }
  if (messages.error) return json(res, 500, { error: messages.error.message })
  if (requests.error) return json(res, 500, { error: requests.error.message })
  return json(res, 200, { messages: messages.data || [], requests: requests.data || [] })
}

async function markNotification(sb, res, body) {
  const now = new Date().toISOString()
  if (body.all === true) {
    const { error } = await sb.from('admin_notifications').update({ read_at: now }).is('read_at', null)
    if (error) return json(res, 500, { error: error.message })
    return json(res, 200, { ok: true })
  }
  const id = String(body.id || '')
  if (!isUuid(id)) return json(res, 400, { error: 'id must be a uuid' })
  const { error } = await sb.from('admin_notifications').update({ read_at: now }).eq('id', id)
  if (error) return json(res, 500, { error: error.message })
  return json(res, 200, { ok: true })
}

async function ticketReply(sb, res, user, body) {
  const ticketId = String(body.ticketId || body.ticket_id || '')
  const text = String(body.body || '').trim()
  const status = body.status == null || body.status === '' ? 'waiting_user' : String(body.status)
  if (!isUuid(ticketId)) return json(res, 400, { error: 'ticketId must be a uuid' })
  if (text.length < 1 || text.length > 4000) return json(res, 400, { error: 'Reply must be 1–4000 characters' })
  if (!isTicketStatus(status) || status === 'bot_handling') {
    return json(res, 400, { error: 'status must be open, waiting_user, escalated, or resolved' })
  }

  const existing = await sb.from('support_tickets').select('id').eq('id', ticketId).maybeSingle()
  if (existing.error) return json(res, 500, { error: existing.error.message })
  if (!existing.data) return json(res, 404, { error: 'Ticket not found' })

  const message = await sb.from('support_ticket_messages').insert({
    ticket_id: ticketId,
    author_id: user.id,
    author_role: 'admin',
    body: text,
  })
  if (message.error) return json(res, 500, { error: message.error.message })

  const patch = {
    status,
    escalation_reason: status === 'escalated' ? 'admin' : null,
  }
  const update = await sb.from('support_tickets').update(patch).eq('id', ticketId).select('id, status').maybeSingle()
  if (update.error) return json(res, 500, { error: update.error.message })
  return json(res, 200, { ok: true, ticket: update.data })
}

async function applicantMessage(sb, res, user, body) {
  const profileId = String(body.profileId || body.profile_id || '')
  const text = String(body.body || '').trim()
  if (!isUuid(profileId)) return json(res, 400, { error: 'profileId must be a uuid' })
  if (text.length < 1 || text.length > 4000) return json(res, 400, { error: 'Message must be 1–4000 characters' })
  return storeApplicantNote(sb, res, user, {
    profileId,
    text,
    kind: 'message',
    subject: 'Message from Clemson RIDES admin',
  })
}

async function infoRequest(sb, res, user, body) {
  const profileId = String(body.profileId || body.profile_id || '')
  const text = String(body.prompt || body.body || '').trim()
  if (!isUuid(profileId)) return json(res, 400, { error: 'profileId must be a uuid' })
  if (text.length < 4 || text.length > 2000) return json(res, 400, { error: 'Describe the details you need (4–2000 characters)' })

  const profile = await sb.from('profiles').select('id, email, full_name').eq('id', profileId).maybeSingle()
  if (profile.error) return json(res, 500, { error: profile.error.message })
  if (!profile.data) return json(res, 404, { error: 'Applicant not found' })

  const notice = await sendApplicantNotice({
    to: profile.data.email,
    subject: 'Clemson RIDES needs more information',
    text: `An admin asked for more information on your driver application:\n\n${text}\n\nOpen the driver application to reply.`,
  })

  const request = await sb.from('driver_info_requests').insert({
    profile_id: profileId,
    requested_by: user.id,
    prompt: text,
    status: 'open',
    email_stub: notice.emailed ? null : notice.stub,
    emailed_at: notice.emailed ? new Date().toISOString() : null,
  }).select('id, status, email_stub, emailed_at').single()
  if (request.error) {
    if (MISSING.test(request.error.message || '')) {
      return json(res, 503, { error: 'Apply supabase/migrations/20260924190000_admin_support.sql' })
    }
    return json(res, 500, { error: request.error.message })
  }

  await sb.from('driver_application_messages').insert({
    profile_id: profileId,
    author_id: user.id,
    author_role: 'admin',
    kind: 'info_request',
    body: text,
    email_stub: notice.emailed ? null : notice.todo,
  })

  return json(res, 200, {
    ok: true,
    request: request.data,
    emailed: notice.emailed,
    email_todo: notice.todo,
  })
}

async function storeApplicantNote(sb, res, user, { profileId, text, kind, subject }) {
  const profile = await sb.from('profiles').select('id, email').eq('id', profileId).maybeSingle()
  if (profile.error) return json(res, 500, { error: profile.error.message })
  if (!profile.data) return json(res, 404, { error: 'Applicant not found' })

  const notice = await sendApplicantNotice({
    to: profile.data.email,
    subject,
    text,
  })

  const inserted = await sb.from('driver_application_messages').insert({
    profile_id: profileId,
    author_id: user.id,
    author_role: 'admin',
    kind,
    body: text,
    email_stub: notice.emailed ? null : notice.todo,
  }).select('id, author_role, kind, body, created_at').single()
  if (inserted.error) {
    if (MISSING.test(inserted.error.message || '')) {
      return json(res, 503, { error: 'Apply supabase/migrations/20260924190000_admin_support.sql' })
    }
    return json(res, 500, { error: inserted.error.message })
  }
  return json(res, 200, {
    ok: true,
    message: inserted.data,
    emailed: notice.emailed,
    email_todo: notice.todo,
  })
}
