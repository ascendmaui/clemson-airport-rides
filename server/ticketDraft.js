export const TICKET_CATEGORIES = ['bug', 'billing', 'ride_dispute', 'account', 'safety', 'other']

export function extractTicketDraft(text) {
  const raw = String(text || '')
  const index = raw.search(/TICKET_DRAFT:\s*\{/)
  if (index === -1) return { visible: raw.trim(), draft: null }
  const visible = raw.slice(0, index).trim()
  const match = raw.slice(index).match(/TICKET_DRAFT:\s*(\{[\s\S]*\})/)
  if (!match) return { visible, draft: null }
  try {
    const parsed = JSON.parse(match[1])
    if (!TICKET_CATEGORIES.includes(parsed.category)) return { visible, draft: null }
    if (parsed.ready !== true) return { visible, draft: null }
    const subject = String(parsed.subject || '').trim()
    const body = String(parsed.body || '').trim()
    if (subject.length < 4 || body.length < 8) return { visible, draft: null }
    return {
      visible,
      draft: {
        category: parsed.category,
        subject: subject.slice(0, 140),
        body: body.slice(0, 4000),
        ready: true,
      },
    }
  } catch {
    return { visible, draft: null }
  }
}
