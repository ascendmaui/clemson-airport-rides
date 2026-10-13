/**
 * POST /api/inbound-mail/hostinger
 *
 * Hostinger Agentic Mail delivers mailbox events as JSON. The webhook secret
 * created with the endpoint is sent on every request as
 * `Authorization: Bearer <secret>` (Mail API: the secret is a bearer token,
 * not a separate HMAC header). Compare it to HOSTINGER_MAIL_WEBHOOK_SECRET.
 *
 * Each accepted event is stored in inbound_agent_mail. When
 * AGENT_INBOX_NOTIFY_URL is set, a JSON copy is POSTed there. An unset URL
 * skips the forward. This module does not send email and does not reply.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { adminClient } from './supabaseAdmin.js'

const SNIPPET_LIMIT = 500
const ADDRESS_LIMIT = 2000
const SUBJECT_LIMIT = 500
const MESSAGE_ID_LIMIT = 998
const NOTIFY_TIMEOUT_MS = 1500

function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max)
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const want = name.toLowerCase()
  const direct = headers[name] ?? headers[want]
  if (Array.isArray(direct)) return direct[0] == null ? '' : String(direct[0])
  if (direct != null) return String(direct)
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== want) continue
    const raw = headers[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    return value == null ? '' : String(value)
  }
  return ''
}

export function bearerToken(header) {
  const match = /^Bearer\s+(\S.*?)\s*$/i.exec(String(header || '').trim())
  if (!match) return ''
  return match[1].replace(/^["']|["']$/g, '').trim()
}

export function webhookSecretMatches(expected, supplied) {
  const secret = String(expected || '').trim()
  const token = String(supplied || '').trim()
  if (!secret || /placeholder/i.test(secret)) return false
  const left = Buffer.from(secret)
  const right = Buffer.from(token)
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
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
      id: data?.id ?? null,
      received_at: data?.received_at ?? null,
    }
  }
  const message = String(error.message || '')
  if (String(error.code) === '23505' || /duplicate key/i.test(message)) {
    return { duplicate: true, id: null, received_at: null }
  }
  const failure = new Error('Could not store inbound mail')
  failure.cause = error
  throw failure
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
  const token = bearerToken(headerValue(req.headers, 'authorization'))
  if (!webhookSecretMatches(env.HOSTINGER_MAIL_WEBHOOK_SECRET, token)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }
  const sb = deps.sb !== undefined ? deps.sb : adminClient()
  if (!sb) {
    sendJson(res, 503, { error: 'Service unavailable' })
    return
  }
  const row = normalizeInboundEvent(req.body)
  let stored
  try {
    stored = await insertInboundMail(sb, row)
  } catch {
    console.error('[inbound-mail] store failed', { message_id: row.message_id })
    sendJson(res, 500, { error: 'Could not store inbound mail' })
    return
  }
  if (!stored.duplicate) {
    const notifyUrl = env.AGENT_INBOX_NOTIFY_URL
    if (notifyTarget(notifyUrl)) {
      await forwardInboxNotify(notifyUrl, {
        source: 'hostinger-agentic-mail',
        id: stored.id,
        message_id: row.message_id,
        from: row.from,
        to: row.to,
        subject: row.subject,
        snippet: row.snippet,
        status: 'new',
        received_at: stored.received_at,
        raw: row.raw,
      }, deps.fetch, deps.notifyTimeoutMs)
    }
  }
  sendJson(res, 200, { ok: true })
}
