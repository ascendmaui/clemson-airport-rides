/**
 * POST /api/inbound-mail/hostinger
 *
 * Hostinger Agentic Mail delivers mailbox events as JSON. The webhook secret
 * is `Authorization: Bearer <secret>`, or the same secret as `?token=` when
 * hPanel can only set a URL. A single HOSTINGER_MAIL_WEBHOOK_SECRET covers
 * every mailbox, or HOSTINGER_MAIL_WEBHOOK_SECRETS maps a secret per mailbox.
 * The query string is not logged.
 *
 * Human mailboxes (support, drivers, riders, press, info) store a reply
 * draft and set status draft_ready. agents@ stores a summary only.
 * noreply@ is send-only and is never processed.
 * press@, info@, and marketing-tagged mail also store a marketing agent draft.
 * Affiliate-tagged and onboarding mail store affiliate or outreach drafts.
 * AGENT_INBOX_NOTIFY_URL, when set, receives a JSON copy for n8n.
 * This module does not send email and does not reply.
 */
import { createHash } from 'node:crypto'
import { mailboxUserPrompt, routeInboundBody } from '../shared/copy/inboundMail.js'
import { draftInboundAgents } from './agentDrafts.js'
import { generateInboxText } from './inboundDraft.js'
import { adminClient } from './supabaseAdmin.js'
import { bearerToken, expectedWebhookSecret, headerValue, queryToken, redactQueryToken, webhookSecretMatches } from './webhookSecret.js'

export { bearerToken, expectedWebhookSecret, webhookSecretMatches } from './webhookSecret.js'

const SNIPPET_LIMIT = 500
const ADDRESS_LIMIT = 2000
const SUBJECT_LIMIT = 500
const MESSAGE_ID_LIMIT = 998
const NOTIFY_TIMEOUT_MS = 1500

function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max)
}

function formatParty(value, max) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? clip(trimmed, max) : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return clip(String(value), max)
  }
  if (Array.isArray(value)) {
    const parts = []
    for (const item of value) {
      const text = formatParty(item, max)
      if (text) parts.push(text)
    }
    if (!parts.length) return null
    return clip(parts.join(', '), max)
  }
  if (typeof value === 'object') {
    const address = typeof value.address === 'string'
      ? value.address.trim()
      : typeof value.email === 'string'
        ? value.email.trim()
        : ''
    if (!address) return null
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    return clip(name ? `${name} <${address}>` : address, max)
  }
  return null
}

function firstParty(candidates, max) {
  for (const value of candidates) {
    const text = formatParty(value, max)
    if (text) return text
  }
  return null
}

function messageObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const message = payload.message
  if (message && typeof message === 'object' && !Array.isArray(message)) return message
  const data = payload.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.message && typeof data.message === 'object' && !Array.isArray(data.message)) {
      return data.message
    }
    return data
  }
  return {}
}

function stringId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? clip(trimmed, MESSAGE_ID_LIMIT) : null
}

function fallbackMessageId(raw) {
  const encoded = JSON.stringify(raw ?? null)
  return `sha256:${createHash('sha256').update(encoded).digest('hex')}`
}

export function normalizeInboundEvent(body) {
  const raw = body && typeof body === 'object' ? body : { body: body ?? null }
  const payload = !Array.isArray(raw) ? raw : { body: raw }
  const message = messageObject(payload)
  const messageId = stringId(message.messageId)
    || stringId(message.message_id)
    || stringId(message.id)
    || stringId(payload.messageId)
    || stringId(payload.message_id)
    || stringId(payload.id)
    || fallbackMessageId(raw)
  return {
    message_id: messageId,
    from: firstParty([message.from, payload.from, message.sender, payload.sender], ADDRESS_LIMIT),
    to: firstParty([
      message.to,
      payload.to,
      message.recipients,
      payload.recipients,
      payload.mailbox,
      message.mailbox,
    ], ADDRESS_LIMIT),
    subject: firstParty([message.subject, payload.subject], SUBJECT_LIMIT),
    snippet: firstParty([
      message.snippet,
      payload.snippet,
      message.preview,
      payload.preview,
      message.excerpt,
      payload.excerpt,
      message.truncated,
      payload.truncated,
      message.truncatedMessage,
      payload.truncatedMessage,
      message.truncated_message,
      payload.truncated_message,
      message.text,
      payload.text,
    ], SNIPPET_LIMIT),
    raw,
    status: 'new',
  }
}

export function notifyTarget(url) {
  const target = String(url || '').trim()
  if (!target) return null
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  return parsed.toString()
}

export async function insertInboundMail(sb, row) {
  const { data, error } = await sb
    .from('inbound_agent_mail')
    .insert(row)
    .select('id, received_at')
    .maybeSingle()
  if (!error) {
    return {
      duplicate: false,
      row: {
        ...row,
        id: data?.id ?? null,
        received_at: data?.received_at ?? null,
      },
    }
  }
  const message = String(error.message || '')
  if (String(error.code) === '23505' || /duplicate key/i.test(message)) {
    const existing = await sb
      .from('inbound_agent_mail')
      .select('id, received_at, status, draft_reply, summary, mailbox, role, message_id')
      .eq('message_id', row.message_id)
      .maybeSingle()
    if (existing?.error) {
      const failure = new Error('Could not store inbound mail')
      failure.cause = existing.error
      throw failure
    }
    return {
      duplicate: true,
      row: {
        ...row,
        ...(existing?.data || {}),
      },
    }
  }
  const failure = new Error('Could not store inbound mail')
  failure.cause = error
  throw failure
}

export async function updateInboundMail(sb, messageId, patch) {
  const { data, error } = await sb
    .from('inbound_agent_mail')
    .update(patch)
    .eq('message_id', messageId)
    .select('id, received_at, status, draft_reply, summary')
    .maybeSingle()
  if (error) {
    const failure = new Error('Could not store inbound mail')
    failure.cause = error
    throw failure
  }
  return data
}

function draftPatch(kind, text) {
  switch (kind) {
    case 'draft':
      return { draft_reply: text, summary: null, status: 'draft_ready' }
    case 'summary':
      return { summary: text, draft_reply: null, status: 'summarized' }
    case 'skip':
      return null
    default: {
      const unknown = kind
      throw new Error(`Unknown mailbox kind ${unknown}`)
    }
  }
}

async function completeMailbox(sb, stored, route, env, deps) {
  const status = stored.row?.status
  if (status === 'draft_ready' || status === 'summarized') {
    return { fresh: false, failed: false }
  }
  if (!route.system) return { fresh: false, failed: false }
  const generated = await generateInboxText({
    env,
    system: route.system,
    user: mailboxUserPrompt(stored.row),
    fetchImpl: deps.draftFetch,
    timeoutMs: deps.draftTimeoutMs,
  })
  if (!generated.ok) {
    if (generated.reason === 'unconfigured' || generated.reason === 'blocked_endpoint') {
      return { fresh: false, failed: false }
    }
    return { fresh: false, failed: true }
  }
  const patch = draftPatch(route.kind, generated.text)
  if (!patch) return { fresh: false, failed: false }
  await updateInboundMail(sb, stored.row.message_id, patch)
  Object.assign(stored.row, patch)
  return { fresh: true, failed: false }
}

export async function forwardInboxNotify(url, payload, fetchImpl, timeoutMs) {
  const target = notifyTarget(url)
  if (!target) return { forwarded: false }
  const fetchFn = fetchImpl || globalThis.fetch
  if (typeof fetchFn !== 'function') return { forwarded: false }
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : NOTIFY_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await fetchFn(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'manual',
    })
    return { forwarded: Boolean(response && response.ok), status: response?.status ?? 0 }
  } catch {
    return { forwarded: false }
  } finally {
    clearTimeout(timer)
  }
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

export default async function handler(req, res, deps = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  const env = deps.env || process.env
  const route = routeInboundBody(req.body)
  const expected = expectedWebhookSecret(env, route)
  const headerToken = bearerToken(headerValue(req.headers, 'authorization'))
  const urlToken = queryToken(req.url)
  if (req.url) req.url = redactQueryToken(req.url)
  if (req.originalUrl) req.originalUrl = redactQueryToken(req.originalUrl)
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'token')) {
    delete req.query.token
  }
  const allowed = webhookSecretMatches(expected, headerToken) || webhookSecretMatches(expected, urlToken)
  if (!allowed) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }
  if (route?.kind === 'skip') {
    sendJson(res, 200, { ok: true, skipped: true })
    return
  }
  const sb = deps.sb !== undefined ? deps.sb : adminClient()
  if (!sb) {
    sendJson(res, 503, { error: 'Service unavailable' })
    return
  }
  const event = normalizeInboundEvent(req.body)
  const row = {
    ...event,
    mailbox: route?.address ?? null,
    role: route?.role ?? null,
    draft_reply: null,
    summary: null,
    status: 'new',
  }
  let stored
  try {
    stored = await insertInboundMail(sb, row)
  } catch {
    console.error('[inbound-mail] store failed', { message_id: row.message_id })
    sendJson(res, 500, { error: 'Could not store inbound mail' })
    return
  }
  let processed = { fresh: false, failed: false }
  if (route && (route.kind === 'draft' || route.kind === 'summary')) {
    try {
      processed = await completeMailbox(sb, stored, route, env, deps)
    } catch {
      console.error('[inbound-mail] draft failed', { message_id: row.message_id })
      processed = { fresh: false, failed: true }
    }
  }
  if (!processed.failed && route && route.kind !== 'skip') {
    try {
      const agents = await draftInboundAgents({
        sb,
        route,
        body: req.body,
        messageId: stored.row?.message_id || row.message_id,
        mailbox: stored.row?.mailbox ?? row.mailbox,
        from: row.from,
        to: row.to,
        subject: row.subject,
        snippet: row.snippet,
        env,
        deps,
      })
      if (agents.fresh) processed = { fresh: true, failed: false }
      if (agents.failed) processed = { fresh: false, failed: true }
    } catch {
      console.error('[inbound-mail] agent draft failed', { message_id: row.message_id })
      processed = { fresh: false, failed: true }
    }
  }
  if (!processed.failed && (!stored.duplicate || processed.fresh)) {
    const notifyUrl = env.AGENT_INBOX_NOTIFY_URL
    if (notifyTarget(notifyUrl)) {
      await forwardInboxNotify(notifyUrl, {
        source: 'hostinger-agentic-mail',
        send: false,
        id: stored.row?.id ?? null,
        message_id: row.message_id,
        mailbox: stored.row?.mailbox ?? row.mailbox,
        role: stored.row?.role ?? row.role,
        from: row.from,
        to: row.to,
        subject: row.subject,
        snippet: row.snippet,
        status: stored.row?.status || 'new',
        draft_reply: stored.row?.draft_reply ?? null,
        summary: stored.row?.summary ?? null,
        received_at: stored.row?.received_at ?? null,
        raw: row.raw,
      }, deps.fetch, deps.notifyTimeoutMs)
    }
  }
  if (processed.failed) {
    sendJson(res, 500, { error: 'Could not draft inbound mail' })
    return
  }
  sendJson(res, 200, { ok: true })
}
