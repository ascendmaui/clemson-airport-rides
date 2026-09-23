/**
 * POST /api/help-chat
 * Rider/Driver Help. Guidance only — never creates tickets.
 */
import { adminClient, userFromAuth } from '../server/supabaseAdmin.js'
import { cors, json, parseBody, rateLimit, sanitizeMessages } from '../server/agentHttp.js'
import { loadUserContext, resolveRoleVariant } from '../server/userContext.js'
import { buildHelpTurn } from '../server/helpAgent.js'
import { respondWithAgent } from '../server/runAgent.js'

async function loadContext(req) {
  const sb = adminClient()
  if (!sb) {
    return {
      context: { signedIn: false },
      userId: null,
      note: 'Personalization needs SUPABASE_SERVICE_ROLE_KEY on Vercel.',
    }
  }
  const user = await userFromAuth(req, sb)
  if (!user) {
    return {
      context: { signedIn: false },
      userId: null,
      note: 'Sign in so Help can use your trips and billing status.',
    }
  }
  const context = await loadUserContext(sb, user)
  return { context, userId: user.id, note: null }
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { error })

  const messages = sanitizeMessages(body.messages)
  if (!messages.some((message) => message.role === 'user')) {
    return json(res, 400, { error: 'Send a question to Help.' })
  }

  let loaded
  try {
    loaded = await loadContext(req)
  } catch (err) {
    console.error('[help-chat] context', err?.message || err)
    loaded = { context: { signedIn: false }, userId: null, note: 'Account context could not be loaded.' }
  }

  if (!rateLimit(req, { bucket: 'help', userId: loaded.userId, limit: 16, windowMs: 60_000 })) {
    return json(res, 429, {
      error: 'Too many Help messages. Wait a minute and try again.',
      reply: 'Too many Help messages. Wait a minute, then ask again. Email support and Terms stay available below.',
      source: 'offline',
    })
  }

  const roleVariant = resolveRoleVariant(loaded.context, body.roleVariant)
  const turn = buildHelpTurn({ messages, context: loaded.context, roleVariant })
  if (loaded.note) turn.reply = `${loaded.note}\n\n${turn.reply}`

  return respondWithAgent(res, {
    name: 'help-chat',
    roleVariant,
    context: loaded.context,
    turn: { ...turn, ticketDraft: null },
  })
}
