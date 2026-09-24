/**
 * POST /api/support-ticket  — file a confirmed ticket, then the support bot replies
 * POST { op: 'reply', ticketId, body } — user follow-up. Bot runs again unless escalated.
 * GET  /api/support-ticket  — caller's tickets, or every ticket for admin/support staff
 */
import { adminClient, userFromAuth } from '../supabaseAdmin.js'
import { cors, json, parseBody, rateLimit } from '../agentHttp.js'
import { validateTicket } from '../supportAgent.js'
import { loadUserContext, resolveRoleVariant } from '../userContext.js'
import { redactPeerText } from '../privacyName.js'
import { loadStaffAccess } from '../staffAccess.js'
import { applySupportBot } from '../applySupportBot.js'

const MISSING_TABLE = /support_tickets|schema cache|does not exist/i

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = adminClient()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' })

  const user = await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const access = await loadStaffAccess(sb, user)

  if (req.method === 'GET') {
    let query = sb
      .from('support_tickets')
      .select('id, user_id, role_variant, category, subject, body, status, bot_intent, escalation_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    if (!access.support) query = query.eq('user_id', user.id)
    const { data, error } = await query
    if (error) {
      if (MISSING_TABLE.test(error.message || '')) {
        return json(res, 503, {
          error: 'Support tickets are not in the database yet. Apply supabase/migrations/20260923120000_support_tickets.sql and supabase/migrations/20260924190000_admin_support.sql.',
          tickets: [],
        })
      }
      if (/column|schema cache/i.test(error.message || '')) {
        const fallback = sb.from('support_tickets').select('id, user_id, role_variant, category, subject, body, status, created_at').order('created_at', { ascending: false }).limit(30)
        const retry = await (access.support ? fallback : fallback.eq('user_id', user.id))
        if (retry.error) return json(res, 500, { error: 'Could not load tickets.' })
        return json(res, 200, { tickets: retry.data || [], isAdmin: access.admin, isStaff: access.support })
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
    return json(res, 200, { tickets, isAdmin: access.admin, isStaff: access.support })
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
  if (body.op === 'reply') return replyToTicket(sb, res, user, context, body)

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

  const inserted = await insertTicket(sb, {
    user_id: user.id,
    role_variant: checked.ticket.roleVariant,
    category: checked.ticket.category,
    subject: checked.ticket.subject,
    body: checked.ticket.body,
    metadata,
  })
  if (inserted.error) return insertError(res, inserted.error)

  const bot = await applySupportBot(sb, {
    ticket: inserted.data,
    context,
    text: `${checked.ticket.subject}\n${checked.ticket.body}`,
    roleVariant: checked.ticket.roleVariant,
  })

  return json(res, 200, {
    ticket: { ...inserted.data, ...bot.ticket },
    bot: {
      reply: bot.decision.reply,
      intent: bot.decision.intent,
      confidence: bot.decision.confidence,
      status: bot.decision.status,
      escalated: bot.decision.escalate,
      reason: bot.decision.reason,
    },
  })
}

async function insertTicket(sb, row) {
  const first = await sb.from('support_tickets').insert({ ...row, status: 'bot_handling' }).select('id, status, category, subject, body, metadata, role_variant, created_at').single()
  if (!first.error) return first
  if (!/check|status/i.test(first.error.message || '')) return first
  return sb.from('support_tickets').insert({ ...row, status: 'open' }).select('id, status, category, subject, body, metadata, role_variant, created_at').single()
}

function insertError(res, error) {
  if (MISSING_TABLE.test(error.message || '')) {
    return json(res, 503, {
      error: 'Support tickets are not in the database yet. Apply supabase/migrations/20260923120000_support_tickets.sql and supabase/migrations/20260924190000_admin_support.sql, or email rides@clemson.edu.',
    })
  }
  if (/foreign key|profiles/i.test(error.message || '')) {
    return json(res, 409, { error: 'Open Account once so your profile exists, then file the ticket again.' })
  }
  console.error('[support-ticket]', error.message)
  return json(res, 500, { error: 'Could not file the ticket.' })
}

async function replyToTicket(sb, res, user, context, body) {
  const ticketId = String(body.ticketId || body.ticket_id || '').trim()
  const text = redactPeerText(String(body.body || '').trim(), context)
  if (!ticketId) return json(res, 400, { error: 'ticketId is required' })
  if (text.length < 1 || text.length > 4000) return json(res, 400, { error: 'Reply must be 1–4000 characters' })

  const existing = await sb
    .from('support_tickets')
    .select('id, user_id, status, category, subject, body, metadata, role_variant')
    .eq('id', ticketId)
    .maybeSingle()
  if (existing.error) return json(res, 500, { error: 'Could not load that ticket.' })
  if (!existing.data || existing.data.user_id !== user.id) return json(res, 404, { error: 'Ticket not found' })

  const message = await sb.from('support_ticket_messages').insert({
    ticket_id: ticketId,
    author_id: user.id,
    author_role: 'user',
    body: text,
  })
  if (message.error && MISSING_TABLE.test(message.error.message || '')) {
    return json(res, 503, { error: 'Apply supabase/migrations/20260924190000_admin_support.sql before replying on a ticket.' })
  }
  if (message.error) return json(res, 500, { error: 'Could not save the reply.' })

  if (existing.data.status === 'escalated') {
    await sb.from('admin_notifications').insert({
      kind: 'support_escalation',
      title: 'Escalated ticket updated',
      body: `${existing.data.subject}`.slice(0, 280),
      entity_type: 'support_ticket',
      entity_id: ticketId,
    })
    return json(res, 200, {
      ticket: { id: ticketId, status: 'escalated' },
      bot: {
        reply: 'An admin already has this ticket. Your reply was added for them.',
        status: 'escalated',
        escalated: true,
        reason: 'already_escalated',
      },
    })
  }

  const bot = await applySupportBot(sb, {
    ticket: existing.data,
    context,
    text,
    roleVariant: existing.data.role_variant,
  })
  return json(res, 200, {
    ticket: bot.ticket,
    bot: {
      reply: bot.decision.reply,
      intent: bot.decision.intent,
      confidence: bot.decision.confidence,
      status: bot.decision.status,
      escalated: bot.decision.escalate,
      reason: bot.decision.reason,
    },
  })
}
