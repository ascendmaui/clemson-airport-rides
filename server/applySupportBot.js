import { decideSupportBot } from './supportBot.js'

const SCHEMA = /schema cache|does not exist|could not find|column|check constraint/i

export async function applySupportBot(sb, { ticket, context, text, roleVariant }) {
  const decision = decideSupportBot({
    text,
    category: ticket?.category,
    context,
    roleVariant: roleVariant || ticket?.role_variant,
  })

  const messageInsert = await sb.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    author_role: 'bot',
    body: decision.reply,
  })

  const patch = {
    status: decision.status,
    bot_intent: decision.intent,
    bot_confidence: decision.confidence,
    escalation_reason: decision.escalate ? decision.reason : null,
  }
  let update = await sb
    .from('support_tickets')
    .update(patch)
    .eq('id', ticket.id)
    .select('id, status, category, subject, bot_intent, bot_confidence, escalation_reason')
    .maybeSingle()

  if (update.error && SCHEMA.test(update.error.message || '')) {
    const legacy = decision.status === 'resolved' ? 'resolved' : 'open'
    update = await sb
      .from('support_tickets')
      .update({
        status: legacy,
        metadata: {
          ...(ticket.metadata || {}),
          bot: {
            intent: decision.intent,
            confidence: decision.confidence,
            status: decision.status,
            escalated: decision.escalate,
            reason: decision.reason,
          },
        },
      })
      .eq('id', ticket.id)
      .select('id, status, category, subject')
      .maybeSingle()
  }

  let notified = false
  if (decision.escalate) {
    const note = await sb.from('admin_notifications').insert({
      kind: 'support_escalation',
      title: 'Support ticket needs review',
      body: `${decision.reason || 'escalated'} · ${String(ticket.subject || '').slice(0, 180)}`,
      entity_type: 'support_ticket',
      entity_id: ticket.id,
    })
    notified = !note.error
  }

  return {
    decision,
    ticket: update.data || { id: ticket.id, status: decision.status },
    messageStored: !messageInsert.error,
    persisted: !update.error,
    notified,
  }
}
