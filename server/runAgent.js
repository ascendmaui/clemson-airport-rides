import { streamText } from 'ai'
import { baseHeaders, json, OFFLINE_NOTICE } from './agentHttp.js'
import { resolveLanguageModel } from './llm.js'
import { contextSummary } from './userContext.js'

function metaHeader(meta) {
  return Buffer.from(JSON.stringify(meta)).toString('base64')
}

export async function respondWithAgent(res, { name, turn, roleVariant, context }) {
  const summary = contextSummary(context)
  const offline = {
    reply: turn.reply,
    actions: turn.actions,
    ticketDraft: turn.ticketDraft || null,
    source: 'offline',
    notice: OFFLINE_NOTICE,
    roleVariant,
    contextSummary: summary,
  }

  const resolved = resolveLanguageModel()
  if (!resolved) return json(res, 200, offline)

  const meta = {
    source: 'llm',
    provider: resolved.provider,
    actions: turn.actions,
    ticketDraft: turn.ticketDraft || null,
    roleVariant,
    contextSummary: summary,
    notice: null,
  }

  try {
    const result = streamText({
      model: resolved.model,
      system: turn.system,
      messages: turn.messages,
      maxOutputTokens: 700,
      temperature: 0.3,
      maxRetries: 1,
    })
    await result.pipeTextStreamToResponse(res, {
      headers: baseHeaders({
        'X-Agent-Meta': metaHeader(meta),
        'Cache-Control': 'no-store',
      }),
    })
  } catch (error) {
    console.error(`[${name}]`, error?.message || 'model error')
    if (res.headersSent || res.writableEnded) {
      try { res.end() } catch { /* stream already closed */ }
      return
    }
    return json(res, 200, {
      ...offline,
      notice: 'The model request failed. Showing guidance from your account and the Clemson RIDES knowledge base.',
    })
  }
}
