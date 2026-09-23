import { supabase } from './supabase'
import { extractTicketDraft } from '../../server/ticketDraft.js'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function decodeMeta(header) {
  if (!header) return null
  try {
    return JSON.parse(atob(header))
  } catch {
    return null
  }
}

function pickDraft(parsed, meta) {
  if (meta?.ticketDraft?.ready) return meta.ticketDraft
  if (parsed?.ready) return parsed
  return null
}

export async function sendAgentMessage({ url, body, onDelta }) {
  const headers = await authHeaders()
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const meta = decodeMeta(res.headers.get('X-Agent-Meta'))
  const contentType = res.headers.get('content-type') || ''

  if (!res.ok && !contentType.includes('text/plain')) {
    const data = await res.json().catch(() => ({}))
    if (data.reply) return { ...data, actions: data.actions || meta?.actions || [] }
    const error = new Error(data.error || data.message || `Request failed (${res.status})`)
    error.payload = data
    throw error
  }

  if (contentType.includes('application/json') || !res.body) {
    const data = await res.json().catch(() => ({}))
    return {
      reply: data.reply || data.error || 'No reply.',
      actions: data.actions || [],
      source: data.source || 'offline',
      notice: data.notice || null,
      roleVariant: data.roleVariant,
      contextSummary: data.contextSummary || null,
      ticketDraft: data.ticketDraft || null,
      redactedUserText: data.redactedUserText || null,
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    full += decoder.decode(value, { stream: true })
    onDelta?.(extractTicketDraft(full).visible)
  }
  const extracted = extractTicketDraft(full)
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

export async function supportTicketRequest(path, options = {}) {
  const headers = await authHeaders()
  const res = await fetch(path, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`)
    error.payload = data
    throw error
  }
  return data
}
