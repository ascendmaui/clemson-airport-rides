import { gateway } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * Document review calls NVIDIA directly.
 * Live check on 2026-10-13: meta/llama-3.2-90b-vision-instruct timed out,
 * meta/llama-3.2-11b-vision-instruct returned 200, and
 * nvidia/nemotron-nano-12b-v2-vl returned HTTP 410.
 * The 11B model is the default. Each call waits about 20s. A timeout, HTTP 5xx,
 * 404, or 410 tries the next id, and Nemotron is included so a restored model is used.
 */
export const NVIDIA_DOC_MODEL_DEFAULT = 'meta/llama-3.2-11b-vision-instruct'
export const NVIDIA_DOC_MODEL_NEMOTRON = 'nvidia/nemotron-nano-12b-v2-vl'
export const NVIDIA_DOC_MODEL_FALLBACK = NVIDIA_DOC_MODEL_NEMOTRON
export const NVIDIA_DOC_CALL_TIMEOUT_MS = 20_000

function clean(value) {
  return String(value || '').trim()
}

function usable(value) {
  const key = clean(value)
  if (!key) return ''
  if (/placeholder|your_.*key|changeme/i.test(key)) return ''
  return key
}

/**
 * Prefer Vercel AI Gateway when AI_GATEWAY_API_KEY is set.
 * Otherwise use OpenAI directly with OPENAI_API_KEY.
 * No tools are attached by callers.
 *
 * This server does not read VERCEL_OIDC_TOKEN. The AI SDK can use that token
 * only inside Vercel, and only if gateway() is called without an API key.
 * Off Vercel the token is absent, so Help and Support need one of the keys above.
 */
let loggedLiveAiOffline = false

export function warnIfLiveAiOffline() {
  if (usable(process.env.AI_GATEWAY_API_KEY)) return
  const openaiKey = usable(process.env.OPENAI_API_KEY)
  if (openaiKey.startsWith('sk-')) return
  if (loggedLiveAiOffline) return
  loggedLiveAiOffline = true
  console.error(
    '[llm] Live AI is offline. Set AI_GATEWAY_API_KEY or OPENAI_API_KEY. VERCEL_OIDC_TOKEN is issued only on Vercel and this server does not use it. Help and Support will answer from the knowledge base.',
  )
}

export function resolveLanguageModel() {
  const requested = clean(process.env.HELP_CHAT_MODEL) || 'gpt-4o-mini'
  const gatewayKey = usable(process.env.AI_GATEWAY_API_KEY)
  if (gatewayKey) {
    const modelId = requested.includes('/') ? requested : `openai/${requested}`
    return { model: gateway(modelId), provider: 'gateway', modelId }
  }
  const openaiKey = usable(process.env.OPENAI_API_KEY)
  if (openaiKey.startsWith('sk-')) {
    const openai = createOpenAI({ apiKey: openaiKey })
    return { model: openai(requested), provider: 'openai', modelId: requested }
  }
  warnIfLiveAiOffline()
  return null
}

/** Vision-capable ids already routed through the AI Gateway. Text-only ids are excluded. */
export function isVisionModelId(modelId) {
  const id = String(modelId || '').toLowerCase()
  if (!id) return false
  if (/embed|whisper|tts|dall-e|moderation|gpt-3\.5|text-/.test(id)) return false
  return /gpt-4o|gpt-4\.1|gpt-5|gemini|claude|pixtral|llava|vision/.test(id)
}

/**
 * Profile photo review prefers the AI Gateway, then the OpenAI key already
 * used by Help and Support. Returns null when neither key is set, or when
 * the configured model cannot see images. Callers then send the photo to
 * the admin queue.
 */
export function resolveVisionModel() {
  const requested = clean(process.env.HELP_CHAT_MODEL) || 'gpt-4o-mini'
  const gatewayKey = usable(process.env.AI_GATEWAY_API_KEY)
  if (gatewayKey) {
    const modelId = requested.includes('/') ? requested : `openai/${requested}`
    if (isVisionModelId(modelId)) return { model: gateway(modelId), provider: 'gateway', modelId }
  }
  const openaiKey = usable(process.env.OPENAI_API_KEY)
  if (openaiKey.startsWith('sk-') && isVisionModelId(requested)) {
    const openai = createOpenAI({ apiKey: openaiKey })
    return { model: openai(requested), provider: 'openai', modelId: requested }
  }
  return null
}

/**
 * Default first, then any other configured id's backup, then Nemotron when it is not already first.
 * A configured Nemotron id still falls back to the 11B model that answered on 2026-10-13.
 */
export function nvidiaDocumentModelIds(requested) {
  const primary = clean(requested) || NVIDIA_DOC_MODEL_DEFAULT
  const ids = [primary]
  if (!ids.includes(NVIDIA_DOC_MODEL_DEFAULT)) ids.push(NVIDIA_DOC_MODEL_DEFAULT)
  if (!ids.includes(NVIDIA_DOC_MODEL_NEMOTRON)) ids.push(NVIDIA_DOC_MODEL_NEMOTRON)
  return ids
}

/**
 * Direct NVIDIA connection for driver documents. No OpenAI key and no AI Gateway.
 * Returns null when NVIDIA_API_KEY is missing so every document waits for a person.
 */
export function resolveNvidiaDocumentModel(env = process.env) {
  const apiKey = usable(env?.NVIDIA_API_KEY)
  if (!apiKey) return null
  const modelIds = nvidiaDocumentModelIds(env?.NVIDIA_DOC_MODEL)
  const client = createOpenAICompatible({
    name: 'nvidia',
    baseURL: env?.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    apiKey,
  })
  return {
    provider: 'nvidia',
    modelId: modelIds[0],
    modelIds,
    fallbackModelId: modelIds[1] || null,
    timeoutMs: NVIDIA_DOC_CALL_TIMEOUT_MS,
    client,
  }
}

function errorStatus(err) {
  const candidates = [err, err?.cause, err?.cause?.cause, err?.response]
  for (const item of candidates) {
    const status = Number(item?.statusCode || item?.status || 0)
    if (status) return status
  }
  return 0
}

function errorText(err) {
  const parts = []
  let current = err
  for (let depth = 0; current && depth < 4; depth += 1) {
    parts.push(current.name, current.code, current.message)
    current = current.cause
  }
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/** Retry another NVIDIA model after a missing id, a timeout, or a server error. */
export function nvidiaCallShouldFallback(err) {
  const status = errorStatus(err)
  if (status === 404 || status === 408 || status === 410) return true
  if (status >= 500 && status <= 599) return true
  const message = errorText(err)
  if (/timeouterror|timeout|timed out|etimedout|und_err_(connect|headers|body)_timeout/.test(message)) return true
  if (/\b(408|410)\b|gone|not found|does not exist|unknown model|model_not_found|is not served|no such model/.test(message)) return true
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout/.test(message)) return true
  return false
}

export const nvidiaModelNotServed = nvidiaCallShouldFallback
