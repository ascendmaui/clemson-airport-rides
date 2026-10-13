/**
 * Marketing, affiliate, and outreach agents.
 * POST /api/agents/marketing, /api/agents/affiliate, and /api/agents/outreach
 * are schedule hooks for n8n. The same Hostinger bearer secret protects them.
 * Inbound mail can store the same drafts.
 * This module does not send email and does not post to social networks.
 */
import { readAffiliateSnapshot } from './affiliateAgentRead.js'
import { generateInboxText } from './inboundDraft.js'
import { adminClient } from './supabaseAdmin.js'
import { bearerToken, headerValue, webhookSecretMatches } from './webhookSecret.js'
import {
  affiliateRecruitmentPrompt,
  affiliateReportBody,
  agentKindsForInbound,
  agentSystem,
  isAgentKind,
  marketingUserPrompt,
  outreachSteps,
  outreachUserPrompt,
  withOutreachFooter,
} from '../shared/copy/agentDrafts.js'

const SUBJECT_LIMIT = 200
const BODY_LIMIT = 8000
const BRIEF_LIMIT = 2000

function clip(text, max) {
  const value = String(text || '')
  return value.length <= max ? value : value.slice(0, max)
}

function modelFailure(generated) {
  if (generated?.ok) return null
  if (generated?.reason === 'unconfigured' || generated?.reason === 'blocked_endpoint') return 'skip'
  return 'fail'
}

async function askModel(env, deps, kind, user) {
  return generateInboxText({
    env,
    system: agentSystem(kind),
    user,
    fetchImpl: deps?.draftFetch,
    timeoutMs: deps?.draftTimeoutMs,
  })
}

async function storeDraft(sb, row) {
  const payload = {
    kind: row.kind,
    status: 'draft_ready',
    subject: clip(row.subject, SUBJECT_LIMIT) || null,
    body: clip(withOutreachFooter(row.body), BODY_LIMIT),
    source: row.source,
    mailbox: row.mailbox || null,
    message_id: row.messageId || null,
    slot: row.slot,
    context: row.context || {},
  }
  if (payload.message_id) {
    const existing = await sb
      .from('agent_drafts')
      .select('id, kind, subject, slot')
      .eq('kind', payload.kind)
      .eq('message_id', payload.message_id)
      .eq('slot', payload.slot)
      .maybeSingle()
    if (existing?.error) {
      const failure = new Error('Could not store agent draft')
      failure.cause = existing.error
      throw failure
    }
    if (existing?.data?.id) return { duplicate: true, row: existing.data }
  }
  const inserted = await sb
    .from('agent_drafts')
    .insert(payload)
    .select('id, kind, subject, slot')
    .maybeSingle()
  if (inserted?.error) {
    const message = String(inserted.error.message || '')
    if (String(inserted.error.code) === '23505' || /duplicate key/i.test(message)) {
      return { duplicate: true, row: payload }
    }
    const failure = new Error('Could not store agent draft')
    failure.cause = inserted.error
    throw failure
  }
  return {
    duplicate: false,
    row: {
      id: inserted?.data?.id ?? null,
      kind: payload.kind,
      subject: payload.subject,
      slot: payload.slot,
    },
  }
}

function mailContext(input) {
  return {
    from: input.from || null,
    to: input.to || null,
    subject: input.subject || null,
    brief: input.brief || null,
  }
}

async function produce(kind, input, env, deps) {
  switch (kind) {
    case 'marketing': {
      const generated = await askModel(env, deps, kind, marketingUserPrompt(input))
      const failure = modelFailure(generated)
      if (failure) return { failure, reason: generated.reason, pieces: [] }
      return {
        failure: null,
        pieces: [{ slot: 'content', subject: input.subject ? `Marketing: ${input.subject}` : 'Marketing draft', body: generated.text }],
      }
    }
    case 'affiliate': {
      const snapshot = await readAffiliateSnapshot(input.sb)
      const report = affiliateReportBody(snapshot)
      const generated = await askModel(env, deps, kind, affiliateRecruitmentPrompt({ ...input, snapshot }))
      const failure = modelFailure(generated)
      const pieces = [{ slot: 'report', subject: 'Affiliate program report', body: report }]
      if (failure) return { failure, reason: generated.reason, pieces }
      pieces.push({ slot: 'recruitment', subject: 'Affiliate recruitment', body: generated.text })
      return { failure: null, pieces }
    }
    case 'outreach': {
      const generated = await askModel(env, deps, kind, outreachUserPrompt(input))
      const failure = modelFailure(generated)
      if (failure) return { failure, reason: generated.reason, pieces: [] }
      return { failure: null, pieces: outreachSteps(generated.text) }
    }
    default: {
      const unknown = kind
      throw new Error(`Unknown agent kind ${unknown}`)
    }
  }
}

async function persist(sb, kind, source, input, pieces) {
  const stored = []
  let fresh = false
  for (const piece of pieces) {
    const result = await storeDraft(sb, {
      kind,
      source,
      slot: piece.slot,
      subject: piece.subject,
      body: piece.body,
      mailbox: input.mailbox,
      messageId: input.messageId,
      context: mailContext(input),
    })
    if (!result.duplicate) fresh = true
    stored.push(result.row)
  }
  return { fresh, stored }
}

export async function draftInboundAgents({ sb, route, body, messageId, mailbox, from, to, subject, snippet, env, deps }) {
  const kinds = agentKindsForInbound(route, body)
  if (!kinds.length) return { fresh: false, failed: false, rows: [] }
  const input = { sb, from, to, subject, snippet, mailbox, messageId, brief: '' }
  const rows = []
  let fresh = false
  for (const kind of kinds) {
    const produced = await produce(kind, input, env, deps)
    if (produced.failure === 'fail') return { fresh, failed: true, rows }
    if (produced.failure === 'skip' && produced.pieces.length === 0) continue
    const saved = await persist(sb, kind, 'mail', input, produced.pieces)
    fresh = fresh || saved.fresh
    rows.push(...saved.stored)
  }
  return { fresh, failed: false, rows }
}

export async function runScheduledAgent({ kind, sb, env, deps, brief }) {
  if (!isAgentKind(kind)) {
    const unknown = kind
    throw new Error(`Unknown agent kind ${unknown}`)
  }
  const input = { sb, brief: clip(brief, BRIEF_LIMIT), mailbox: null, messageId: null }
  const produced = await produce(kind, input, env, deps)
  if (produced.failure === 'fail') return { failed: true, rows: [], reason: produced.reason || 'http' }
  if (produced.pieces.length === 0) {
    return { failed: false, rows: [], reason: produced.reason || 'unconfigured' }
  }
  const saved = await persist(sb, kind, 'schedule', input, produced.pieces)
  return {
    failed: false,
    rows: saved.stored,
    reason: produced.failure === 'skip' ? (produced.reason || 'unconfigured') : null,
  }
}

function requestBrief(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  return clip(payload.brief || payload.note || '', BRIEF_LIMIT)
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  res.statusCode = status
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
  }
  res.end(JSON.stringify(body))
}

export function publicDraft(row) {
  return {
    id: row?.id ?? null,
    kind: row?.kind ?? null,
    subject: row?.subject ?? null,
    slot: row?.slot ?? null,
  }
}

export default async function handler(req, res, deps = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  const env = deps.env || process.env
  const token = bearerToken(headerValue(req.headers, 'authorization'))
  if (!webhookSecretMatches(env.HOSTINGER_MAIL_WEBHOOK_SECRET, token)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }
  const url = new URL(req.url || '/', 'http://localhost')
  const kind = url.searchParams.get('kind') || ''
  if (!isAgentKind(kind)) {
    sendJson(res, 400, { error: 'Unknown agent' })
    return
  }
  const sb = deps.sb !== undefined ? deps.sb : adminClient()
  if (!sb) {
    sendJson(res, 503, { error: 'Service unavailable' })
    return
  }
  try {
    const result = await runScheduledAgent({
      kind,
      sb,
      env,
      deps,
      brief: requestBrief(req.body),
    })
    if (result.failed) {
      sendJson(res, 500, { error: 'Could not draft' })
      return
    }
    sendJson(res, 200, {
      ok: true,
      send: false,
      kind,
      drafts: result.rows.map(publicDraft),
      ...(result.reason ? { reason: result.reason } : {}),
    })
  } catch {
    console.error('[agent-drafts] schedule failed', { kind })
    sendJson(res, 500, { error: 'Could not draft' })
  }
}
