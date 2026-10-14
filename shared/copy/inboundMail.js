/**
 * Mailbox roles for inbound Clemson RIDES mail.
 * Human mailboxes get a reply draft for approval. agents@ is a summary only.
 * noreply@ is send-only and is never processed.
 * Nothing in this file sends email.
 */

const DOMAIN = 'clemsonrides.com'

export const INBOUND_PRODUCT_RULES = [
  'Clemson RIDES connects riders with independent drivers in Clemson, South Carolina. It is not Clemson University transit.',
  'Ride types are only Standard, Wait & Save, Extra Comfort, and Carpool. Do not name any other ride type.',
  'A ride request places a pre-authorization hold for the estimated fare plus a buffer. The full fare is captured when the trip ends, and the hold is released if the trip is canceled within policy.',
  'A person drives every ride. Do not describe an autonomous vehicle.',
  'Drivers use their own cars. Do not promise a company-owned car, a guaranteed vehicle, or a dispatch plan.',
  'Do not invent prices, refunds, arrival times, or ridership numbers.',
].join('\n')

const DRAFT_TASK = 'Write the reply draft only, in plain text, with no subject line. John approves it before anyone sends it. Do not say the message has been sent.'
const SUMMARY_TASK = 'Write a short summary for John only. These notes are CI, deploy, and pull request alerts. Do not draft a reply and do not write an email.'

function draftSystem(mailboxLine) {
  return `${INBOUND_PRODUCT_RULES}\n\n${mailboxLine}\n${DRAFT_TASK}`
}

function mailbox(local, role, kind, label, system) {
  return Object.freeze({
    local,
    address: `${local}@${DOMAIN}`,
    role,
    kind,
    label,
    system,
  })
}

export const INBOUND_MAILBOXES = Object.freeze({
  support: mailbox(
    'support',
    'support',
    'draft',
    'Customer help',
    draftSystem('You are drafting for support@clemsonrides.com. This mailbox is customer help: the app, billing, safety, and ride problems.'),
  ),
  drivers: mailbox(
    'drivers',
    'drivers',
    'draft',
    'Onboarding and driver questions',
    draftSystem('You are drafting for drivers@clemsonrides.com. This mailbox is driver onboarding and driver questions. Do not plan vehicle assignment.'),
  ),
  riders: mailbox(
    'riders',
    'riders',
    'draft',
    'Booking questions',
    draftSystem('You are drafting for riders@clemsonrides.com. This mailbox answers booking questions: how to request a ride, the four ride types, and airport or campus trips.'),
  ),
  press: mailbox(
    'press',
    'press',
    'draft',
    'Media and content requests',
    draftSystem('You are drafting for press@clemsonrides.com. This mailbox is media and content requests. Be brief and offer that John will follow up. Do not invent a story.'),
  ),
  info: mailbox(
    'info',
    'info',
    'draft',
    'General triage',
    draftSystem('You are drafting for info@clemsonrides.com. This mailbox is general triage. Answer from the product rules, and name support@, drivers@, riders@, or press@ when the note belongs there.'),
  ),
  agents: mailbox(
    'agents',
    'agents',
    'summary',
    'CI, deploy, and pull request alerts',
    `${INBOUND_PRODUCT_RULES}\n\nYou read agents@clemsonrides.com.\n${SUMMARY_TASK}`,
  ),
  noreply: mailbox(
    'noreply',
    'noreply',
    'skip',
    'Send only',
    '',
  ),
})

const DRAFT_ORDER = Object.freeze(['support', 'drivers', 'riders', 'press', 'info'])
const SUMMARY_ORDER = Object.freeze(['agents'])

function instructionKind(kind) {
  switch (kind) {
    case 'draft':
    case 'summary':
    case 'skip':
      return kind
    default: {
      const unknown = kind
      throw new Error(`Unknown mailbox kind ${unknown}`)
    }
  }
}

export function mailboxFromAddress(value) {
  const found = emailAddresses(value)
  for (const email of found) {
    const at = email.lastIndexOf('@')
    if (at <= 0) continue
    if (email.slice(at + 1) !== DOMAIN) continue
    const local = email.slice(0, at)
    const box = INBOUND_MAILBOXES[local]
    if (box) return box
  }
  return null
}

export function routeRecipients(values) {
  const found = []
  for (const value of values) {
    const addresses = emailAddresses(value)
    for (const address of addresses) {
      const box = mailboxFromAddress(address)
      if (box) found.push(box)
    }
  }
  for (const local of DRAFT_ORDER) {
    const hit = found.find((box) => box.local === local)
    if (hit) return hit
  }
  for (const local of SUMMARY_ORDER) {
    const hit = found.find((box) => box.local === local)
    if (hit) return hit
  }
  const skip = found.find((box) => instructionKind(box.kind) === 'skip')
  return skip || null
}

export function routeInboundBody(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const message = payload.message && typeof payload.message === 'object' && !Array.isArray(payload.message)
    ? payload.message
    : {}
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : {}
  return routeRecipients([
    message.to,
    payload.to,
    message.recipients,
    payload.recipients,
    payload.mailbox,
    message.mailbox,
    data.to,
    data.mailbox,
    data.message && data.message.to,
  ])
}

export function mailboxUserPrompt({ from, to, subject, snippet }) {
  return [
    'Inbound message:',
    `From: ${from || '(unknown)'}`,
    `To: ${to || '(unknown)'}`,
    `Subject: ${subject || '(no subject)'}`,
    '',
    snippet || '(no excerpt)',
  ].join('\n').slice(0, 4000)
}

function emailAddresses(value, out = []) {
  if (value == null) return out
  if (typeof value === 'string') {
    const found = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)
    if (found) {
      for (const item of found) out.push(item.toLowerCase())
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) emailAddresses(item, out)
    return out
  }
  if (typeof value === 'object') {
    emailAddresses(value.address, out)
    emailAddresses(value.email, out)
    if (!value.address && !value.email) emailAddresses(value.mailbox, out)
  }
  return out
}
