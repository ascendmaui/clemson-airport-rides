/**
 * Test double for server/applySupportBot.js.
 * Records the call and returns a fixed decision. Does not write, send mail, or call a model.
 */

export const state = {
  calls: [],
  result: null,
}

export async function applySupportBot(sb, input) {
  state.calls.push({ sb, input })
  if (state.result) return state.result
  const decision = {
    reply: 'Stub support reply. No message was sent.',
    intent: 'stub_intent',
    confidence: 0.8,
    status: 'bot_handling',
    escalate: false,
    reason: null,
  }
  return {
    decision,
    ticket: { id: input.ticket?.id ?? null, status: decision.status },
    messageStored: false,
    persisted: false,
    notified: false,
  }
}
