/**
 * Copy and routing for the marketing, affiliate, and outreach draft agents.
 * Drafts are for John's approval. Nothing here sends email or posts anywhere.
 */
import { AFFILIATE_LINK_ORIGIN } from '../affiliates/config.js'
import { describeAffiliatePlan } from '../affiliates/rules.js'
import { INBOUND_PRODUCT_RULES } from './inboundMail.js'

export const OUTREACH_MAILING_ADDRESS = '101 North Main Street, Greenville, SC 29601'

export const AGENT_KINDS = Object.freeze(['marketing', 'affiliate', 'outreach'])

const NO_SOCIAL = 'Do not post to social networks. Write email drafts only.'
const APPROVAL = 'John approves this draft before anyone sends it. Do not say the message has been sent.'
const FOOTER_LINE = `Close the email with a footer that includes this mailing address: ${OUTREACH_MAILING_ADDRESS}`

const MARKETING_LOCALS = new Set(['press', 'info'])

export function isAgentKind(kind) {
  switch (kind) {
    case 'marketing':
    case 'affiliate':
    case 'outreach':
      return true
    default:
      return false
  }
}

export function agentSystem(kind) {
  switch (kind) {
    case 'marketing':
      return [
        INBOUND_PRODUCT_RULES,
        '',
        'You draft marketing content, campaign ideas, and outreach email for Clemson RIDES.',
        'You watch press@clemsonrides.com, info@clemsonrides.com, and mail tagged marketing.',
        NO_SOCIAL,
        APPROVAL,
        FOOTER_LINE,
      ].join('\n')
    case 'affiliate':
      return [
        INBOUND_PRODUCT_RULES,
        '',
        'You draft a partner recruitment email for the Clemson RIDES affiliate program.',
        'Use only the figures in the user message. If a figure is missing, say it is not available.',
        'Do not change affiliate records and do not move money.',
        NO_SOCIAL,
        APPROVAL,
        FOOTER_LINE,
      ].join('\n')
    case 'outreach':
      return [
        INBOUND_PRODUCT_RULES,
        '',
        'You draft a partner onboarding email sequence of three emails.',
        'Start each email with its own line: Email 1, Email 2, or Email 3.',
        'Each email has a Subject line.',
        NO_SOCIAL,
        APPROVAL,
        FOOTER_LINE,
      ].join('\n')
    default: {
      const unknown = kind
      throw new Error(`Unknown agent kind ${unknown}`)
    }
  }
}

export function withOutreachFooter(text) {
  const body = String(text || '').trim()
  if (body.includes(OUTREACH_MAILING_ADDRESS)) return body
  return `${body}\n\nClemson RIDES\n${OUTREACH_MAILING_ADDRESS}`
}

export function outreachSteps(text) {
  const raw = String(text || '').trim()
  const parts = raw.split(/\n(?=Email [123]\b)/).map((part) => part.trim()).filter(Boolean)
  const steps = parts.filter((part) => /^Email [123]\b/.test(part)).slice(0, 3)
  if (steps.length >= 2) {
    return steps.map((part, index) => ({
      slot: `step-${index + 1}`,
      subject: subjectLine(part) || `Partner onboarding ${index + 1}`,
      body: withOutreachFooter(part),
    }))
  }
  return [{
    slot: 'sequence',
    subject: subjectLine(raw) || 'Partner onboarding sequence',
    body: withOutreachFooter(raw),
  }]
}

function subjectLine(block) {
  const match = /^subject:\s*(.+)$/im.exec(block)
  return match ? match[1].trim().slice(0, 200) : ''
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function pushTag(out, value) {
  if (value == null) return
  if (Array.isArray(value)) {
    for (const item of value) pushTag(out, item)
    return
  }
  if (typeof value === 'object') {
    pushTag(out, value.name)
    pushTag(out, value.tag)
    pushTag(out, value.value)
    return
  }
  const text = String(value).trim().toLowerCase()
  if (text) out.push(text)
}

function headerTag(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const want = name.toLowerCase()
  const direct = headers[name] ?? headers[want]
  if (Array.isArray(direct)) return direct[0] == null ? '' : String(direct[0])
  if (direct != null) return String(direct)
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== want) continue
    const raw = headers[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    return value == null ? '' : String(value)
  }
  return ''
}

export function mailSignals(body) {
  const payload = asObject(body)
  const message = asObject(payload.message)
  const data = asObject(payload.data)
  const tags = []
  pushTag(tags, payload.tags)
  pushTag(tags, payload.labels)
  pushTag(tags, payload.tag)
  pushTag(tags, message.tags)
  pushTag(tags, message.labels)
  pushTag(tags, message.tag)
  pushTag(tags, data.tags)
  pushTag(tags, data.labels)
  const headers = asObject(message.headers || payload.headers || data.headers)
  for (const name of ['x-clemson-tag', 'x-mail-tag', 'x-agent-tag']) {
    pushTag(tags, headerTag(headers, name))
  }
  const subject = String(message.subject || payload.subject || data.subject || '')
  return { subject, tags }
}

function wordIn(text, word) {
  return new RegExp(`\\b${word}\\b`, 'i').test(text)
}

function tagHits(tags, word) {
  return tags.some((tag) => tag.split(/[^a-z0-9]+/).filter(Boolean).includes(word))
}

function signalHits(signals, word) {
  return tagHits(signals.tags, word) || wordIn(signals.subject, word)
}

export function agentKindsForInbound(route, body) {
  if (!route || route.kind === 'skip') return []
  const signals = mailSignals(body)
  const kinds = []
  if (MARKETING_LOCALS.has(route.local) || signalHits(signals, 'marketing')) kinds.push('marketing')
  if (signalHits(signals, 'affiliate')) kinds.push('affiliate')
  if (signalHits(signals, 'outreach') || signalHits(signals, 'onboarding')) kinds.push('outreach')
  return kinds
}

function clipPrompt(lines) {
  return lines.filter((line) => line != null).join('\n').slice(0, 4000)
}

export function marketingUserPrompt({ from, to, subject, snippet, brief }) {
  return clipPrompt([
    'Write one marketing draft: a campaign idea and a short outreach email.',
    brief ? `Brief: ${brief}` : '',
    from || to || subject || snippet ? 'Inbound message:' : 'No inbound message. Draft a campaign John can approve.',
    from ? `From: ${from}` : '',
    to ? `To: ${to}` : '',
    subject ? `Subject: ${subject}` : '',
    snippet || '',
  ])
}

function dollars(cents) {
  const amount = Number(cents)
  if (!Number.isFinite(amount)) return 'unavailable'
  const text = (amount / 100).toFixed(2)
  return text.endsWith('.00') ? `$${text.slice(0, -3)}` : `$${text}`
}

export function affiliateReportBody(snapshot) {
  const live = snapshot?.available === true
  const rates = snapshot?.rates && typeof snapshot.rates === 'object' ? snapshot.rates : null
  const plan = describeAffiliatePlan(rates || undefined)
  const lines = [
    'Affiliate program report',
    '',
  ]
  if (!live) {
    lines.push('Live affiliate counts were not available. No totals are included.')
  } else {
    lines.push('Counts cover at most the latest 500 rows read for this draft.')
    lines.push(`Affiliates read: ${snapshot.affiliates.length}`)
    lines.push(`By status: ${formatCounts(snapshot.affiliates, 'status')}`)
    lines.push(`By partner type: ${formatCounts(snapshot.affiliates, 'partner_type')}`)
    lines.push(`Attributions read: ${snapshot.attributions.length}`)
    lines.push(`Attributions by status: ${formatCounts(snapshot.attributions, 'status')}`)
    lines.push(`Ledger rows read: ${snapshot.ledger.length}`)
    lines.push(`Ledger cents by status: ${formatCents(snapshot.ledger)}`)
    lines.push(`Clicks: ${snapshot.clickCount == null ? 'unavailable' : snapshot.clickCount}`)
  }
  lines.push('')
  if (rates) lines.push('Rates were read from affiliate_config. Missing fields below use the published default.')
  else lines.push('The live rate row was not available. Figures below are the published defaults, not a live total.')
  lines.push(`Referred rider: ${dollars(plan.rider_first_ride_cents)} when the first completed fare is at least ${dollars(plan.rider_min_fare_cents)}.`)
  lines.push(`Referred driver: ${dollars(plan.driver_first_trip_cents)} when the first trip is completed.`)
  for (const partner of plan.partners) {
    lines.push(`${partner.label}: ${partner.multiplier_label}`)
  }
  if (plan.multipliers_pending_confirmation && plan.multipliers_note) {
    lines.push(plan.multipliers_note)
  }
  lines.push(`Public pages: ${AFFILIATE_LINK_ORIGIN}/affiliate and ${AFFILIATE_LINK_ORIGIN}/affiliates`)
  lines.push('This report is a draft for John. It does not pay anyone and it does not change affiliate records.')
  return lines.join('\n')
}

function formatCounts(rows, key) {
  const counts = {}
  for (const row of rows || []) {
    const name = String(row?.[key] || 'unknown')
    counts[name] = (counts[name] || 0) + 1
  }
  const parts = Object.entries(counts)
  if (!parts.length) return 'none'
  return parts.map(([name, count]) => `${name} ${count}`).join(', ')
}

function formatCents(rows) {
  const sums = {}
  for (const row of rows || []) {
    const name = String(row?.status || 'unknown')
    sums[name] = (sums[name] || 0) + (Number(row?.amount_cents) || 0)
  }
  const parts = Object.entries(sums)
  if (!parts.length) return 'none'
  return parts.map(([name, cents]) => `${name} ${cents}`).join(', ')
}

export function affiliateRecruitmentPrompt({ snapshot, brief, from, to, subject, snippet }) {
  return clipPrompt([
    'Write one partner recruitment email. Do not repeat the report as a spreadsheet.',
    'Use only these figures:',
    affiliateReportBody(snapshot),
    brief ? `Brief: ${brief}` : '',
    from || subject || snippet ? 'Inbound message:' : '',
    from ? `From: ${from}` : '',
    to ? `To: ${to}` : '',
    subject ? `Subject: ${subject}` : '',
    snippet || '',
  ])
}

export function outreachUserPrompt({ from, to, subject, snippet, brief }) {
  return clipPrompt([
    'Write the three-email partner onboarding sequence.',
    brief ? `Brief: ${brief}` : '',
    from || subject || snippet ? 'Inbound message:' : 'No inbound message. Draft the standard partner onboarding sequence.',
    from ? `From: ${from}` : '',
    to ? `To: ${to}` : '',
    subject ? `Subject: ${subject}` : '',
    snippet || '',
  ])
}
