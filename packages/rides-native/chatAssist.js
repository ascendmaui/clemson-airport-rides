/**
 * Driver chat assistant — intent detection, trip-context templates, and the
 * money-promise guard. Pure: shared by /api/trip-messages?action=assist, the
 * driver TripThread, and unit tests.
 *
 * Fare, refund, discount, and charge questions are never answered automatically.
 */

export const AUTO_REPLY_PREFIX = 'Auto-reply: '
export const ASSIST_MODES = ['auto', 'suggest', 'off']

const RULES = [
  // Order matters: money questions win over everything else.
  { intent: 'fare_refund', re: /\b(refund|overcharg\w*|charged (me )?(twice|wrong|too much)|money back|dispute|discount|promo|coupon|how much|price|cost|fare|cheaper|waive)\b/i },
  { intent: 'payment_tip', re: /\b(tip|tipping|pay(ing|ment)?|cash|venmo|zelle|card|apple pay)\b/i },
  { intent: 'eta', re: /\b(eta|how long|how far|when (will|are|r) (you|u)|minutes?|mins?|almost here|on (your|ur) way|running late|be here soon)\b/i },
  { intent: 'location', re: /\b(where (are|r) (you|u)|where you at|wya|your location|can'?t (see|find) (you|u|the car))\b/i },
  { intent: 'pickup_spot', re: /\b(pick ?up|meet (you|u)|where should i|which (door|entrance|side|terminal|level)|curb|pin|outside|lobby)\b/i },
  { intent: 'luggage', re: /\b(luggage|bags?|suitcases?|trunk|carry[- ]?on|backpack|room for|ski|golf clubs)\b/i },
  { intent: 'car', re: /\b(what (car|color|vehicle|kind of car)|which car|plate|license|make|model|what are you driving|describe)\b/i },
]

/** @returns {{ intent: string|null, confidence: number }} */
export function detectIntent(text) {
  const body = String(text || '').trim()
  if (!body || body.length > 500) return { intent: null, confidence: 0 }
  for (const rule of RULES) {
    if (rule.re.test(body)) {
      const question = /\?|\b(where|when|how|what|which|can|do|is|are)\b/i.test(body)
      return { intent: rule.intent, confidence: question ? 0.9 : 0.6 }
    }
  }
  return { intent: null, confidence: 0 }
}

/** Intents that may be sent without the driver tapping Send. */
export const AUTO_SENDABLE = new Set(['eta', 'location', 'pickup_spot', 'luggage', 'car', 'payment_tip'])

const MONEY_PROMISE = /(\$\s?\d|\b\d+\s?(dollars|bucks)\b|\brefund|\bdiscount|\bcredit(ed)?\b|\bwaiv|\bfree\b|\bcomp(ed|ensat)|\bmoney back|\bcheaper|\bwon'?t (be )?charge|\bno charge|\bprice (will|is)|\bfare (will|is)|\bcost(s)? (will|is))/i

/** True when text promises or quotes money. Such text must never be auto-sent. */
export function containsMoneyPromise(text) {
  return MONEY_PROMISE.test(String(text || ''))
}

function km(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Rough live ETA in minutes from the driver's last fix. Road factor 1.35, 40 km/h average. */
export function estimateEtaMinutes(driver, target) {
  const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
  if (!ok(driver) || !ok(target)) return null
  const dist = km({ lat: Number(driver.lat), lng: Number(driver.lng) }, { lat: Number(target.lat), lng: Number(target.lng) }) * 1.35
  return Math.max(1, Math.round((dist / 40) * 60))
}

export function vehicleLine(vehicle) {
  if (!vehicle) return null
  const name = [vehicle.color, vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
  if (!name) return null
  return vehicle.plate ? `${name}, plate ${vehicle.plate}` : name
}

const PRE_PICKUP = new Set(['accepted', 'arriving', 'driver_assigned', 'en_route'])

/**
 * Deterministic reply from trip context. Never mentions amounts.
 * ctx: { status, etaMinutes, pickupLabel, vehicle, arrived }
 */
export function templateReply(intent, ctx = {}) {
  const car = vehicleLine(ctx.vehicle)
  const pickup = ctx.pickupLabel ? String(ctx.pickupLabel).slice(0, 80) : null
  const arrived = ctx.arrived || ctx.status === 'arrived'
  const eta = Number.isFinite(ctx.etaMinutes) ? ctx.etaMinutes : null
  switch (intent) {
    case 'eta':
      if (arrived) return `I'm here at the pickup${pickup ? ` (${pickup})` : ''}.${car ? ` Look for a ${car}.` : ''}`
      if (ctx.status === 'in_progress') return eta ? `About ${eta} min to your drop-off.` : `We're on the way to your drop-off.`
      return eta ? `On my way, about ${eta} min out.` : `On my way. I'll message when I'm close.`
    case 'location':
      if (arrived) return `I'm at the pickup${pickup ? `: ${pickup}` : ''}.${car ? ` ${car}.` : ''}`
      return eta ? `I'm about ${eta} min away. You can follow my car on the map in the app.` : `I'm on my way. You can follow my car on the map in the app.`
    case 'pickup_spot':
      return pickup
        ? `I'll meet you at ${pickup}. If you'd like a different spot nearby, message me and I'll confirm.`
        : `I'll come to the pickup pin. If you'd like a different spot nearby, message me and I'll confirm.`
    case 'luggage':
      return `Should be fine. Let me know how many bags so I can make room.`
    case 'car':
      return car ? `I'm in a ${car}.` : `Check the app for my car and plate.`
    case 'payment_tip':
      return `Payment goes through the app, so you don't need cash. Tips are optional and can be added in the app after the ride.`
    case 'fare_refund':
      return `I can't change fares or charges. Please use Help > Dispute fare in the app and support will review it.`
    default:
      return null
  }
}

/**
 * Pick the final text. LLM output is used only if it passes the guard; otherwise the template.
 * Fare/refund questions are never auto-sendable.
 */
export function finalizeReply({ intent, template, llmText }) {
  let text = template
  let source = 'template'
  const cleaned = String(llmText || '').replace(/^["']|["']$/g, '').replace(/^auto-reply:\s*/i, '').trim()
  if (cleaned && cleaned.length <= 300 && !containsMoneyPromise(cleaned) && intent !== 'fare_refund') {
    text = cleaned
    source = 'llm'
  }
  if (!text) return null
  const autoSendable = AUTO_SENDABLE.has(intent) && !containsMoneyPromise(text)
  return { text, source, autoSendable }
}

export function isAutoReply(body) {
  return String(body || '').startsWith(AUTO_REPLY_PREFIX)
}

export function asAutoReply(text) {
  return `${AUTO_REPLY_PREFIX}${String(text || '').trim()}`.slice(0, 500)
}

export const PRE_PICKUP_STATUSES = PRE_PICKUP
