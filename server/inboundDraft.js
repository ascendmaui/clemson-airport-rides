/**
 * Draft and summary text for inbound mail.
 * Calls an OpenAI-compatible chat endpoint with NVIDIA_API_KEY.
 * The default host is NVIDIA's integrate API. api.openai.com is refused.
 * This module does not send email.
 */

export const DEFAULT_DRAFT_BASE_URL = 'https://integrate.api.nvidia.com/v1'
export const DEFAULT_DRAFT_MODEL = 'openai/gpt-oss-120b'
const DRAFT_TIMEOUT_MS = 8000

const BLOCKED_HOSTS = new Set([
  'api.openai.com',
  'openai.com',
])

function clean(value) {
  return String(value || '').trim()
}

function usableKey(value) {
  const key = clean(value)
  if (!key) return ''
  if (/placeholder|your_.*key|changeme/i.test(key)) return ''
  return key
}

export function draftEndpoint(env) {
  const baseText = clean(env?.AGENT_DRAFT_BASE_URL) || DEFAULT_DRAFT_BASE_URL
  let parsed
  try {
    parsed = new URL(baseText)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.openai.com') || host.endsWith('.openai.azure.com')) {
    return null
  }
  const model = clean(env?.AGENT_DRAFT_MODEL) || DEFAULT_DRAFT_MODEL
  const key = usableKey(env?.NVIDIA_API_KEY)
  const base = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '')
  return { base, model, key, configured: Boolean(key) }
}

function completionText(payload) {
  const choice = payload?.choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      return ''
    }).join('').trim()
  }
  if (typeof choice?.text === 'string') return choice.text.trim()
  return ''
}

export async function generateInboxText({ env, system, user, fetchImpl, timeoutMs }) {
  const endpoint = draftEndpoint(env)
  if (!endpoint) return { ok: false, reason: 'blocked_endpoint' }
  if (!endpoint.configured) return { ok: false, reason: 'unconfigured' }
  const fetchFn = fetchImpl || globalThis.fetch
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'unconfigured' }
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DRAFT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await fetchFn(`${endpoint.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${endpoint.key}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
      redirect: 'manual',
    })
    if (!response?.ok) return { ok: false, reason: 'http' }
    const payload = typeof response.json === 'function' ? await response.json() : null
    const text = completionText(payload).slice(0, 4000)
    if (!text) return { ok: false, reason: 'empty' }
    return { ok: true, text }
  } catch {
    return { ok: false, reason: 'http' }
  } finally {
    clearTimeout(timer)
  }
}
