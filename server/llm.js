import { gateway } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * Document review calls NVIDIA directly. The default is Llama 3.2 90B vision.
 * nvidia/nemotron-nano-12b-v2-vl returned HTTP 410 on integrate.api.nvidia.com
 * (2026-10-13). Set NVIDIA_DOC_MODEL to that id if NVIDIA serves it again.
 * If the configured id is not served, the caller retries the 11B vision model.
 */
export const NVIDIA_DOC_MODEL_DEFAULT = 'meta/llama-3.2-90b-vision-instruct'
export const NVIDIA_DOC_MODEL_FALLBACK = 'meta/llama-3.2-11b-vision-instruct'

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
 * Direct NVIDIA connection for driver documents. No OpenAI key and no AI Gateway.
 * Returns null when NVIDIA_API_KEY is missing so every document waits for a person.
 */
export function resolveNvidiaDocumentModel(env = process.env) {
  const apiKey = usable(env?.NVIDIA_API_KEY)
  if (!apiKey) return null
  const modelId = clean(env?.NVIDIA_DOC_MODEL) || NVIDIA_DOC_MODEL_DEFAULT
  const client = createOpenAICompatible({
    name: 'nvidia',
    baseURL: env?.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    apiKey,
  })
  return {
    provider: 'nvidia',
    modelId,
    fallbackModelId: modelId === NVIDIA_DOC_MODEL_FALLBACK ? null : NVIDIA_DOC_MODEL_FALLBACK,
    client,
  }
}

export function nvidiaModelNotServed(err) {
  const status = Number(err?.statusCode || err?.status || err?.cause?.statusCode || err?.cause?.status || 0)
  if (status === 404 || status === 410) return true
  const message = String(err?.message || err || '').toLowerCase()
  return /410|gone|not found|does not exist|unknown model|model_not_found|is not served|no such model/.test(message)
}
