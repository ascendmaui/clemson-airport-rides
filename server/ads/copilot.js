/**
 * AI co-pilot for partner ads (server only). Flag: ADS_AI_COPILOT_ENABLED (default off).
 *
 * Text suggestions use a model that is ALREADY configured for Help and Support
 * (AI_GATEWAY_API_KEY or OPENAI_API_KEY via server/llm.js). With no model it falls back to
 * built-in templates, so the co-pilot never needs a new key to be useful.
 * Image generation needs ADS_AI_IMAGE_MODEL plus an existing gateway/OpenAI key; nothing is
 * generated otherwise. Video generation has no provider yet and reports what is needed.
 *
 * Caps: ADS_AI_PARTNER_DAILY_CAP requests per partner per 24 h (default 20) and
 * ADS_AI_DAILY_COST_CAP_CENTS estimated spend across everyone per 24 h (default 300).
 * Every output passes shared/ads/copilotSafety.js and is saved as a creative that still
 * needs John's approval.
 */
import { generateText } from 'ai'
import { resolveLanguageModel } from '../llm.js'
import { copyIssues, isBlocked, withAgeNote } from '../../shared/ads/copilotSafety.js'
import { ownCampaign, ownPartner } from './tracking.js'

export const COPILOT_FLAG = 'ADS_AI_COPILOT_ENABLED'
export const COST_CENTS = { suggest: 1, image: 4, video: 50 }
const DAY_MS = 24 * 60 * 60 * 1000
const THEMES = ['purple', 'orange', 'light']
const LAYOUTS = ['qr-right', 'qr-left', 'full-bleed']

function fail(status, error, extra = {}) {
  const e = new Error(error)
  e.status = status
  Object.assign(e, extra)
  return e
}
const must = ({ data, error }, what) => {
  if (error) throw fail(500, `${what}: ${error.message || error}`)
  return data
}
const usable = (v) => {
  const k = String(v || '').trim()
  return k && !/placeholder|your_.*key|changeme/i.test(k) ? k : ''
}

export function copilotEnabled(env = process.env) {
  return String(env[COPILOT_FLAG] || '').toLowerCase() === 'true'
}

/** Which providers are configured. Names only, never values. */
export function providerStatus(env = process.env) {
  const gateway = usable(env.AI_GATEWAY_API_KEY)
  const openai = usable(env.OPENAI_API_KEY).startsWith('sk-')
  const text = gateway ? 'gateway' : openai ? 'openai' : null
  const imageModel = usable(env.ADS_AI_IMAGE_MODEL)
  const image = imageModel && (gateway || openai) ? (gateway ? 'gateway' : 'openai') : null
  return {
    enabled: copilotEnabled(env),
    text: text || 'templates',
    image,
    video: null,
    needs: [
      ...(text ? [] : ['Optional: AI_GATEWAY_API_KEY or OPENAI_API_KEY for AI-written copy (templates work without it).']),
      ...(image ? [] : ['Images: set ADS_AI_IMAGE_MODEL (for example openai/gpt-image-1) on top of an existing AI_GATEWAY_API_KEY or OPENAI_API_KEY.']),
      'Video: no provider wired. Needs a video-generation API key (for example xAI or Runway) approved by John.',
    ],
  }
}

/* ---------------- Templates (no AI needed) ---------------- */

const CATEGORY_IDEAS = {
  food: { offers: ['Free appetizer with any entrée before kickoff', '$2 off any order when you show this QR', 'Late-night combo: 2 slices + a drink for $7'], theme: 'orange' },
  bar: { offers: ['Game-day wings special before kickoff. 21+ with ID for drinks.', 'Half-price apps for the first hour after the game', 'Show this QR for a free order of fries'], theme: 'orange' },
  retail: { offers: ['20% off game-day shirts this weekend', 'Buy one hat, get one 50% off', '10% off your first visit with this QR'], theme: 'purple' },
  service: { offers: ['First session free', '$10 off your first appointment', 'Free consultation this week'], theme: 'light' },
  housing: { offers: ['$0 application fee this month', 'Tour this week, get $100 off move-in', 'Free parking for fall leases'], theme: 'purple' },
}

export function categoryKey(category = '') {
  const c = String(category).toLowerCase()
  if (/bar|tavern|pub|grill/.test(c)) return 'bar'
  if (/food|restaurant|pizza|cafe|coffee|eat/.test(c)) return 'food'
  if (/retail|shop|store|boutique|clothing/.test(c)) return 'retail'
  if (/apartment|housing|leasing|rent/.test(c)) return 'housing'
  return 'service'
}

function templateSuggestion({ businessName = 'Your business', category = '', idea = '', instruction = '', previous = null }) {
  const key = categoryKey(category)
  const base = CATEGORY_IDEAS[key]
  const offers = idea ? [idea, ...base.offers].slice(0, 3) : base.offers
  let headlines = [`${businessName}: ${offers[0]}`.slice(0, 80), `Riding to ${businessName}?`.slice(0, 80), 'Scan for tonight\'s deal'.slice(0, 80)]
  let dealText = offers[0]
  let theme = previous?.theme || base.theme
  let layout = previous?.layout || 'qr-right'
  if (previous) {
    headlines = [previous.headline, ...headlines].filter(Boolean).slice(0, 3)
    dealText = previous.dealText || dealText
  }
  const ins = String(instruction).toLowerCase()
  if (/bold|louder|punch/.test(ins)) { headlines = headlines.map((h) => h.toUpperCase()); theme = 'orange'; layout = 'full-bleed' }
  if (/short|tight|less/.test(ins)) { headlines = headlines.map((h) => h.split(/[:.!]/)[0].slice(0, 32)); dealText = dealText.split(/[.]/)[0] }
  if (/calm|light|clean|minimal/.test(ins)) theme = 'light'
  if (/purple/.test(ins)) theme = 'purple'
  if (/orange/.test(ins)) theme = 'orange'
  if (/qr.*left/.test(ins)) layout = 'qr-left'
  return { offers, headlines, dealText, theme, layout }
}

/* ---------------- AI path ---------------- */

const SYSTEM = [
  'You write short ads for local businesses shown on a tablet inside Clemson Rides cars (rideshare with human drivers in Clemson, SC).',
  'Return ONLY JSON: {"offers":[3 strings],"headlines":[3 strings <= 60 chars],"dealText":"<=140 chars","theme":"purple|orange|light","layout":"qr-right|qr-left|full-bleed","notes":"one sentence"}.',
  'Every ad has a QR code riders scan; write a clear reason to scan now.',
  'Rules: never mention car brands or cars that drive themselves; never use Clemson University names, logos, slogans or the Tiger Paw;',
  'drink specials must say 21+ and must never target anyone under 21. Clemson local flavor is fine: game day, Death Valley, downtown, College Ave.',
].join(' ')

function parseJson(text = '') {
  const m = String(text).match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

function clean(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Keep only safe output; auto-add 21+ to drink copy. */
export function sanitizeSuggestion(raw = {}, fallback = {}) {
  const fix = (s, max) => {
    const t = withAgeNote(clean(s, max))
    return t && !isBlocked(copyIssues(t)) ? t.slice(0, max) : ''
  }
  const offers = (Array.isArray(raw.offers) ? raw.offers : []).map((o) => fix(o, 140)).filter(Boolean).slice(0, 3)
  const headlines = (Array.isArray(raw.headlines) ? raw.headlines : []).map((h) => fix(h, 80)).filter(Boolean).slice(0, 3)
  const dealText = fix(raw.dealText, 160)
  return {
    offers: offers.length ? offers : (fallback.offers || []).map((o) => fix(o, 140)).filter(Boolean),
    headlines: headlines.length ? headlines : (fallback.headlines || []).map((h) => fix(h, 80)).filter(Boolean),
    dealText: dealText || fix(fallback.dealText, 160),
    theme: THEMES.includes(raw.theme) ? raw.theme : (fallback.theme || 'purple'),
    layout: LAYOUTS.includes(raw.layout) ? raw.layout : (fallback.layout || 'qr-right'),
    notes: clean(raw.notes, 200),
  }
}

/* ---------------- Caps ---------------- */

export async function checkCaps(sb, partnerId, kind, { env = process.env, now = new Date() } = {}) {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const rows = must(await sb.from('ad_ai_usage').select('partner_id, cost_cents').gte('created_at', since), 'usage') || []
  const partnerCap = Number(env.ADS_AI_PARTNER_DAILY_CAP) || 20
  const costCap = Number(env.ADS_AI_DAILY_COST_CAP_CENTS) || 300
  const mine = rows.filter((r) => r.partner_id === partnerId).length
  const spent = rows.reduce((s, r) => s + (Number(r.cost_cents) || 0), 0)
  if (mine >= partnerCap) throw fail(429, `Daily co-pilot limit reached (${partnerCap}). Try again tomorrow.`)
  if (spent + (COST_CENTS[kind] || 0) > costCap) throw fail(429, 'The co-pilot is resting for today. Try again tomorrow.')
  return { used: mine, partnerCap, spentCents: spent, costCapCents: costCap }
}

async function logUsage(sb, partnerId, kind, provider, now) {
  await sb.from('ad_ai_usage').insert({ partner_id: partnerId, kind, provider, cost_cents: provider === 'templates' ? 0 : (COST_CENTS[kind] || 0), created_at: now.toISOString() })
}

/* ---------------- Actions ---------------- */

/** Suggest offers, headlines, copy, layout and colors. body: { idea, instruction, previous } */
export async function copilotSuggest(sb, user, body = {}, deps = {}) {
  const env = deps.env || process.env
  const now = deps.now || new Date()
  if (!copilotEnabled(env)) throw fail(404, 'The ad co-pilot is not available yet.')
  const partner = await ownPartner(sb, user, body.partnerId)
  await checkCaps(sb, partner.id, 'suggest', { env, now })
  const input = {
    businessName: partner.business_name,
    category: partner.category || body.category || '',
    idea: clean(body.idea, 200),
    instruction: clean(body.instruction, 200),
    previous: body.previous && typeof body.previous === 'object'
      ? { headline: clean(body.previous.headline, 80), dealText: clean(body.previous.dealText, 160), theme: body.previous.theme, layout: body.previous.layout }
      : null,
  }
  const fallback = templateSuggestion(input)
  const resolved = (deps.resolveLanguageModel || resolveLanguageModel)()
  let source = 'templates'
  let out = sanitizeSuggestion(fallback, fallback)
  if (resolved?.model) {
    try {
      const gen = deps.generateText || generateText
      const prompt = JSON.stringify({ business: input.businessName, category: input.category, idea: input.idea, current: input.previous, change: input.instruction || null })
      const r = await gen({ model: resolved.model, system: SYSTEM, prompt, maxOutputTokens: 500, temperature: 0.8 })
      const parsed = parseJson(r?.text)
      if (parsed) { out = sanitizeSuggestion(parsed, fallback); source = resolved.provider || 'ai' }
    } catch (err) {
      console.error('[ads copilot] text', err?.message || err)
    }
  }
  await logUsage(sb, partner.id, 'suggest', source, now)
  return { suggestion: out, source }
}

/** Generate a 16:9 background image. Needs ADS_AI_IMAGE_MODEL; deps.generateImage is injected in tests. */
export async function copilotImage(sb, user, body = {}, deps = {}) {
  const env = deps.env || process.env
  const now = deps.now || new Date()
  if (!copilotEnabled(env)) throw fail(404, 'The ad co-pilot is not available yet.')
  const status = providerStatus(env)
  if (!deps.generateImage && !status.image) throw fail(501, 'Image generation is not set up.', { needs: status.needs })
  const partner = await ownPartner(sb, user, body.partnerId)
  const prompt = clean(body.prompt, 400)
  const issues = copyIssues(prompt)
  if (isBlocked(issues)) throw fail(400, issues[0].message, { issues })
  await checkCaps(sb, partner.id, 'image', { env, now })
  const full = `${prompt}. Photorealistic 16:9 ad background for a local business in Clemson, SC. No text, no logos, no university insignia, no car brands.`
  const gen = deps.generateImage
  if (!gen) throw fail(501, 'Image generation is not set up.', { needs: status.needs })
  const img = await gen({ prompt: full, aspectRatio: '16:9' })
  const path = `copilot/${partner.id}/${now.getTime()}.png`
  must(await sb.storage.from('ad-creatives').upload(path, img.bytes, { contentType: img.contentType || 'image/png', upsert: false }), 'upload')
  await logUsage(sb, partner.id, 'image', status.image || 'injected', now)
  return { storagePath: path, contentType: img.contentType || 'image/png' }
}

export async function copilotVideo(_sb, _user, _body = {}, deps = {}) {
  const env = deps.env || process.env
  if (!copilotEnabled(env)) throw fail(404, 'The ad co-pilot is not available yet.')
  throw fail(501, 'Video generation is not set up.', { needs: providerStatus(env).needs })
}

/** Save the chosen suggestion as a creative on a draft campaign. Always pending review. */
export async function copilotSave(sb, user, body = {}, deps = {}) {
  const env = deps.env || process.env
  const now = deps.now || new Date()
  if (!copilotEnabled(env)) throw fail(404, 'The ad co-pilot is not available yet.')
  const c = await ownCampaign(sb, user, body.campaignId)
  if (c.status !== 'draft') throw fail(409, 'Add co-pilot ads to a draft campaign.')
  const headline = withAgeNote(clean(body.headline, 80)).slice(0, 80)
  const dealText = withAgeNote(clean(body.dealText, 160)).slice(0, 160)
  const issues = copyIssues([headline, dealText])
  if (!headline) throw fail(400, 'Add a headline.')
  if (isBlocked(issues)) throw fail(400, issues[0].message, { issues })
  const storagePath = body.storagePath && String(body.storagePath).startsWith(`copilot/${c.partner_id}/`) ? String(body.storagePath) : null
  const row = {
    campaign_id: c.id,
    kind: storagePath ? 'image' : 'built',
    storage_path: storagePath,
    media_url: storagePath ? sb.storage.from('ad-creatives').getPublicUrl(storagePath)?.data?.publicUrl || null : null,
    headline,
    deal_text: dealText || null,
    qr_url: c.destination_url || null,
    theme: THEMES.includes(body.theme) ? body.theme : 'purple',
    approval_status: 'pending_review',
    review_note: 'made with the AI co-pilot',
    updated_at: now.toISOString(),
  }
  const creative = must(await sb.from('ad_creatives').insert(row).select('*').single(), 'creative')
  return { creative }
}
