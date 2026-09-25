import { extractTicketDraft } from '../../server/ticketDraft.js'

function decodeMeta(header) {
  if (!header) return null
  try {
    const json = typeof atob === 'function'
      ? atob(header)
      : Buffer.from(header, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

function pickDraft(parsed, meta) {
  if (meta?.ticketDraft?.ready) return meta.ticketDraft
  if (parsed?.ready) return parsed
  return null
}

function shapeJson(data, meta) {
  return {
    reply: data.reply || data.error || 'No reply.',
    actions: data.actions || meta?.actions || [],
    source: data.source || meta?.source || 'offline',
    notice: data.notice || meta?.notice || null,
    roleVariant: data.roleVariant || meta?.roleVariant,
    contextSummary: data.contextSummary || meta?.contextSummary || null,
    ticketDraft: data.ticketDraft || meta?.ticketDraft || null,
    redactedUserText: data.redactedUserText || meta?.redactedUserText || null,
  }
}

/**
 * Parse a finished Help or Support HTTP body.
 * The server returns JSON when the model is offline, and text/plain plus X-Agent-Meta when it streams.
 */
export function parseAgentHttpResponse({ ok, status, contentType, metaHeader, text }) {
  const meta = decodeMeta(metaHeader)
  const type = contentType || ''
  const body = String(text || '')
  const looksJson = type.includes('application/json') || body.trim().startsWith('{')

  if (!ok && !type.includes('text/plain')) {
    let data = {}
    try { data = JSON.parse(body) } catch { data = {} }
    if (data.reply) return shapeJson(data, meta)
    const error = new Error(data.error || data.message || `Request failed (${status})`)
    error.payload = data
    throw error
  }

  if (looksJson && !type.includes('text/plain')) {
    let data = {}
    try { data = JSON.parse(body) } catch { data = {} }
    return shapeJson(data, meta)
  }

  const extracted = extractTicketDraft(body)
  return {
    reply: extracted.visible || 'I could not produce a reply. Try again.',
    actions: meta?.actions || [],
    source: meta?.source || 'llm',
    notice: meta?.notice || null,
    roleVariant: meta?.roleVariant,
    contextSummary: meta?.contextSummary || null,
    ticketDraft: pickDraft(extracted.draft, meta),
    redactedUserText: meta?.redactedUserText || null,
  }
}

export async function postAgent({ url, headers, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return parseAgentHttpResponse({
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    metaHeader: res.headers.get('X-Agent-Meta'),
    text,
  })
}

export async function supportTicketRequest({ url, headers, method = 'GET', body }) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || data.message || `Request failed (${res.status})`)
    error.payload = data
    throw error
  }
  return data
}
