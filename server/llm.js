import { gateway } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

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
 */
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
  return null
}
