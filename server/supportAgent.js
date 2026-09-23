import { PRODUCT_BRIEF, action, sanitizeActions } from './productKnowledge.js'
import { contextForPrompt } from './userContext.js'
import { SUPPORT_CHIPS, categoryLabel } from './agentChips.js'
import { TICKET_CATEGORIES, extractTicketDraft } from './ticketDraft.js'

export { SUPPORT_CHIPS, categoryLabel, TICKET_CATEGORIES, extractTicketDraft }

const CATEGORY_RULES = [
  ['safety', /\b(safety|unsafe|harass|harassment|threat|assault|emergency|scared|stalk)\b/i],
  ['billing', /\b(bill\w*|charge\w*|card|refund\w*|deposit|payment|stripe|receipt|fare|payout)\b/i],
  ['bug', /\b(bug\w*|crash\w*|broken|error\w*|glitch\w*|freez\w*|won'?t load|does not work|doesn't work|not working|cannot go online|can't go online)\b/i],
  ['ride_dispute', /\b(no-show|no show|dispute|wrong pickup|never arrived|cancel|late driver|late rider)\b/i],
  ['account', /\b(account|login|log in|sign in|password|locked out|can't sign|cannot sign)\b/i],
]

const CATEGORY_ONLY = /^(i have a (billing issue|ride dispute|account problem|safety concern)|i want to report a bug|i have a bug: i cannot go online|i have a billing issue about a fare)\.?$/i

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return ''
}

export function detectCategory(messages) {
  const text = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n')
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return category
  }
  return null
}

function detailFrom(messages) {
  const lines = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter((line) => line && !CATEGORY_ONLY.test(line))
  return lines.join('\n').trim()
}

function subjectFor(category, detail) {
  const first = detail.split('\n').map((line) => line.trim()).find(Boolean) || categoryLabel(category)
  const compact = first.replace(/\s+/g, ' ')
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}

function draftBody({ category, detail, context, role }) {
  const latest = context?.recentTrips?.[0]
  const lines = [
    detail,
    '',
    `Variant: ${role}`,
    context?.signedIn ? `Name: ${context.name || 'signed in'}` : 'Name: signed out',
    `Card on file: ${context?.billing?.hasCard ? 'yes' : 'no'}`,
    `Student verified: ${context?.student?.verified ? 'yes' : 'no'}`,
    latest ? `Latest trip: ${latest.status || 'unknown'} · ${latest.pickup || 'pickup'} → ${latest.dropoff || 'dropoff'}` : 'Latest trip: none on file',
  ]
  if (role === 'driver') {
    lines.push(context?.vehicle
      ? `Vehicle: ${[context.vehicle.make, context.vehicle.model].filter(Boolean).join(' ') || 'on file'}`
      : 'Vehicle: none')
    if (context?.driverApplication?.status) lines.push(`Driver application: ${context.driverApplication.status}`)
  }
  return lines.join('\n').slice(0, 4000)
}

export function validateTicket(input) {
  if (!input || input.confirmed !== true) {
    return { ok: false, error: 'Confirm the ticket in Support before it is filed.' }
  }
  if (!TICKET_CATEGORIES.includes(input.category)) {
    return { ok: false, error: 'Category must be bug, billing, ride dispute, account, safety, or other.' }
  }
  const subject = String(input.subject || '').trim()
  const body = String(input.body || '').trim()
  if (subject.length < 4 || subject.length > 140) {
    return { ok: false, error: 'Subject should be 4–140 characters.' }
  }
  if (body.length < 8 || body.length > 4000) {
    return { ok: false, error: 'Add a short description before filing.' }
  }
  return {
    ok: true,
    ticket: {
      category: input.category,
      subject,
      body,
      roleVariant: input.roleVariant === 'driver' ? 'driver' : 'rider',
    },
  }
}

function diagnosis(category, context, role) {
  const latest = context?.recentTrips?.[0]
  if (category === 'billing') {
    const card = context?.billing?.hasCard
      ? `A ${context.billing.brand || 'card'}${context.billing.last4 ? ` ending ${context.billing.last4}` : ''} is on file.`
      : 'No card is on file. That blocks friend-ride charges. Airport deposits use Checkout from Schedule and can fail separately.'
    const trip = latest?.fareUsd != null
      ? ` Latest trip fare on file: $${latest.fareUsd} (${latest.pickup || 'pickup'} → ${latest.dropoff || 'dropoff'}, ${latest.status || 'status unknown'}).`
      : ''
    return `${card}${trip} I cannot refund or change a Stripe charge from chat.`
  }
  if (category === 'bug' && role === 'driver' && !context?.vehicle) {
    return 'Driver mode needs a vehicle. If you cannot go online, finish Account → Vehicle → Driver signup first. If signup already succeeded and the map still fails, say what you see and we will file that.'
  }
  if (category === 'ride_dispute' && latest) {
    return `The newest trip I can see is ${latest.status || 'unknown'}: ${latest.pickup || 'pickup'} → ${latest.dropoff || 'dropoff'}. Tell me what went wrong on that ride, or name a different one.`
  }
  if (category === 'account') {
    return context?.student?.verified
      ? 'Your sign-in email is on the profile and student pricing is on. Describe what you cannot open or change.'
      : 'Student pricing is off for this profile. If the issue is access, say whether sign-in, password, or the Student tab is the problem. I will not ask for your password.'
  }
  if (category === 'safety') {
    return 'If you are in immediate danger, contact local emergency services before using this chat. Tell me what happened in the ride or account, without sending documents or card numbers.'
  }
  return 'Describe what happened, what you expected, and which screen you were on.'
}

export function supportSystemPrompt(roleVariant, context, draft) {
  const role = roleVariant === 'driver' ? 'driver' : 'rider'
  return `You are the Clemson RIDES ${role === 'driver' ? 'Driver' : 'Rider'} Support agent.
You help with problems: bugs, billing, ride disputes, account access, and safety. You are not the Help agent. Do not answer with a feature tour unless it diagnoses this issue.
You cannot change Stripe, trips, or accounts. You prepare a support ticket. You must not say a ticket was created. The app files it only after the user confirms a card.

Rules:
- Use USER CONTEXT. Never invent charges, trips, or policies.
- Do not invent refunds or payout dates.
- Never ask for a full card number, password, or API key.
- Safety: if someone may be in danger, tell them to contact local emergency services first.
- If PREPARED DRAFT is present, ask them to review the confirm card. Do not output TICKET_DRAFT.
- If PREPARED DRAFT is null and you truly have a category plus a concrete story, you may end with one line:
TICKET_DRAFT: {"category":"bug|billing|ride_dispute|account|safety|other","subject":"...","body":"...","ready":true}
- Otherwise ask one specific question. Use their latest trip or card status when it is in context.

PRODUCT:
${PRODUCT_BRIEF}

USER CONTEXT:
${JSON.stringify(contextForPrompt(context))}

PREPARED DRAFT:
${draft ? JSON.stringify(draft) : 'null'}

Active support variant: ${role}.`
}

export function buildSupportTurn({ messages, context, roleVariant }) {
  const role = roleVariant === 'driver' ? 'driver' : 'rider'
  const question = lastUserText(messages)
  const category = detectCategory(messages)
  const detail = detailFrom(messages)
  const actions = [action('Open Help', 'account', { tab: 'help' })]
  const name = context?.signedIn ? (context.name || 'there') : 'there'

  if (!question) {
    return {
      reply: `Hi ${name}. This is Support, separate from Help. Tell me about a billing issue, a ride, a bug, your account, or a safety concern. I will not file a ticket until you confirm it.`,
      actions: sanitizeActions(actions),
      ticketDraft: null,
      system: supportSystemPrompt(role, context, null),
    }
  }

  if (!category) {
    return {
      reply: `Hi ${name}. I can file a ticket after we agree on it. What kind of issue is this: billing, a ride dispute, a bug, account access, or safety?`,
      actions: sanitizeActions(actions),
      ticketDraft: null,
      system: supportSystemPrompt(role, context, null),
    }
  }

  const lead = category === 'safety'
    ? 'If you are in immediate danger, contact local emergency services first.'
    : `Hi ${name}. I am treating this as ${categoryLabel(category).toLowerCase()}.`

  if (detail.length < 12) {
    return {
      reply: `${lead}\n\n${diagnosis(category, context, role)}\n\nI have not filed a ticket yet.`,
      actions: sanitizeActions(actions),
      ticketDraft: null,
      system: supportSystemPrompt(role, context, null),
    }
  }

  const ticketDraft = {
    category,
    subject: subjectFor(category, detail),
    body: draftBody({ category, detail, context, role }),
    ready: true,
  }

  return {
    reply: `${lead}\n\n${diagnosis(category, context, role)}\n\nI put a ticket summary in the confirm card. Nothing is filed until you press Confirm and file. I cannot refund a charge or change a trip from here.`,
    actions: sanitizeActions(category === 'billing'
      ? [action('Open Billing', 'account', { tab: 'billing' }), ...actions]
      : actions),
    ticketDraft,
    system: supportSystemPrompt(role, context, ticketDraft),
  }
}
