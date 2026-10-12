/**
 * POST /api/trip-messages?action=assist  { tripId }
 * Driver-only. Looks at the newest rider message on an active trip, detects a common
 * question, and returns a reply drafted from trip context (live ETA, vehicle, pickup).
 * Never writes messages: the driver app sends under the driver's own session (RLS),
 * labeled "Auto-reply: " when the driver has Auto-reply on.
 * LLM (AI Gateway / OpenAI via server/llm.js) only rephrases; output that mentions
 * money falls back to the deterministic template. Keys stay on the server.
 */
import { generateText } from 'ai'
import { rateLimit } from '../agentHttp.js'
import { resolveLanguageModel } from '../llm.js'
import {
  detectIntent, estimateEtaMinutes, finalizeReply, PRE_PICKUP_STATUSES, templateReply,
} from '../../packages/rides-native/chatAssist.js'

const ACTIVE = new Set(['accepted', 'arriving', 'arrived', 'in_progress'])

const SYSTEM = [
  'You rewrite a rideshare driver\'s short chat reply to a rider. Clemson, SC.',
  'Keep every fact from the draft. Add no new facts. One or two short sentences, friendly, no emoji.',
  'Never mention prices, fares, refunds, discounts, credits, charges, or dollar amounts. Never promise anything about money.',
  'Reply with the message text only.',
].join(' ')

export async function polishWithLlm(draft, question, deps = {}) {
  const resolved = (deps.resolveLanguageModel || resolveLanguageModel)()
  if (!resolved) return null
  try {
    const result = await (deps.generateText || generateText)({
      model: resolved.model,
      system: SYSTEM,
      prompt: `Rider asked: "${String(question).slice(0, 300)}"\nDraft reply: "${draft}"`,
      maxOutputTokens: 90,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(5000),
    })
    return String(result?.text || '').trim() || null
  } catch (err) {
    console.error('[chat-assist] llm', err?.message || err)
    return null
  }
}

export async function loadAssistContext(sb, tripId) {
  const { data: trip } = await sb.from('trips')
    .select('id, status, rider_id, driver_id, pickup_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, arrived_at')
    .eq('id', tripId).maybeSingle()
  if (!trip) return { trip: null }
  const [msgs, loc, veh] = await Promise.all([
    sb.from('trip_messages').select('id, sender_id, body, created_at').eq('trip_id', tripId).order('created_at', { ascending: false }).limit(6),
    sb.from('trip_driver_locations').select('lat, lng, updated_at').eq('trip_id', tripId).maybeSingle(),
    trip.driver_id
      ? sb.from('vehicles').select('make, model, color, plate, year').eq('driver_id', trip.driver_id).order('created_at', { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
  ])
  return { trip, messages: msgs.data || [], driverLoc: loc.data || null, vehicle: (veh.data || [])[0] || null }
}

export function buildAssist({ trip, messages, driverLoc, vehicle }) {
  const latest = messages[0]
  if (!latest || latest.sender_id !== trip.rider_id) return { reason: 'no-rider-question' }
  const { intent, confidence } = detectIntent(latest.body)
  if (!intent) return { reason: 'no-intent', messageId: latest.id }
  const toPickup = PRE_PICKUP_STATUSES.has(trip.status) || trip.status === 'arriving'
  const target = toPickup ? { lat: trip.pickup_lat, lng: trip.pickup_lng } : { lat: trip.dropoff_lat, lng: trip.dropoff_lng }
  const ctx = {
    status: trip.status,
    arrived: trip.status === 'arrived' || (Boolean(trip.arrived_at) && trip.status !== 'in_progress'),
    etaMinutes: estimateEtaMinutes(driverLoc, target),
    pickupLabel: trip.pickup_label,
    vehicle,
  }
  return { intent, confidence, messageId: latest.id, question: latest.body, template: templateReply(intent, ctx) }
}

export default async function handleChatAssist(req, res, { sb, user, body, json }, deps = {}) {
  if (!rateLimit(req, { bucket: 'chat-assist', userId: user.id, limit: 20, windowMs: 10 * 60_000 })) {
    return json(res, 429, { error: 'Too many assistant requests. Try again in a few minutes.' })
  }
  const tripId = String(body?.tripId || '')
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) return json(res, 400, { error: 'tripId required' })
  const context = await (deps.loadAssistContext || loadAssistContext)(sb, tripId)
  if (!context.trip || context.trip.driver_id !== user.id) return json(res, 403, { error: 'Only the driver on this trip can use the assistant.' })
  if (!ACTIVE.has(context.trip.status)) return json(res, 200, { ok: true, suggestion: null, reason: 'trip-not-active' })
  const draft = buildAssist(context)
  if (!draft.intent) return json(res, 200, { ok: true, suggestion: null, reason: draft.reason, messageId: draft.messageId || null })
  const llmText = draft.intent === 'fare_refund' ? null : await polishWithLlm(draft.template, draft.question, deps)
  const reply = finalizeReply({ intent: draft.intent, template: draft.template, llmText })
  return json(res, 200, {
    ok: true,
    messageId: draft.messageId,
    intent: draft.intent,
    suggestion: reply,
  })
}
