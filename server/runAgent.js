import { streamText } from 'ai'
import { baseHeaders, json, OFFLINE_NOTICE } from './agentHttp.js'
import { resolveLanguageModel } from './llm.js'
import { contextSummary } from './userContext.js'
import { redactPeerText, scrubMessages } from './privacyName.js'

function metaHeader(meta) {
  return Buffer.from(JSON.stringify(meta)).toString('base64')
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return ''
}

function scrubDraft(draft, context) {
  if (!draft?.ready) return draft || null
  return {
    ...draft,
    subject: redactPeerText(draft.subject, context).slice(0, 140),
    body: redactPeerText(draft.body, context).slice(0, 4000),
  }
}

async function writeText(res, headers, text) {
  res.statusCode = 200
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(text)
}

export async function respondWithAgent(res, { name, turn, roleVariant, context }) {
  const messages = scrubMessages(turn.messages, context)
  const summary = redactPeerText(contextSummary(context), context)
  const reply = redactPeerText(turn.reply, context)
  const ticketDraft = scrubDraft(turn.ticketDraft, context)
  const redactedUserText = lastUserText(messages)
  const offline = {
    reply,
    actions: turn.actions,
    ticketDraft,
    source: 'offline',
    notice: OFFLINE_NOTICE,
    roleVariant,
    contextSummary: summary,
    redactedUserText,
  }

  const resolved = resolveLanguageModel()
  if (!resolved) return json(res, 200, offline)

  const meta = {
    source: 'llm',
    provider: resolved.provider,
    actions: turn.actions,
    ticketDraft,
    roleVariant,
    contextSummary: summary,
    notice: null,
    redactedUserText,
  }

  try {
    const result = streamText({
      model: resolved.model,
      system: redactPeerText(turn.system, context),
      messages,
      maxOutputTokens: 700,
      temperature: 0.3,
      maxRetries: 1,
    })
    let full = ''
    for await (const chunk of result.textStream) full += chunk
    await writeText(res, baseHeaders({
      'X-Agent-Meta': metaHeader(meta),
      'Cache-Control': 'no-store',
    }), redactPeerText(full, context))
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
