/**
 * Server friend-ride quote. Confirm charges these stored shares for 10 minutes.
 * The client may send the quote id and signature. Amount fields are ignored.
 * A request with no quote id still charges a fresh stored quote (legacy apps).
 * Pass `now` (ms) to tests; otherwise the clock is Date.now.
 */
import { randomUUID } from 'node:crypto'

export const FRIEND_QUOTE_TTL_MS = 10 * 60 * 1000

const QUOTE_ID_KEYS = ['quoteId', 'quote_id']
const QUOTE_SIGNATURE_KEYS = ['quoteSignature', 'quote_signature']

function normalizeCents(value) {
  if (value == null || value === '') return null
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? n : null
}

function clockMs(now) {
  const n = now == null ? Date.now() : Number(now)
  return Number.isFinite(n) ? n : null
}

/** Sorted participant ids. Order on the ride does not change the set. */
export function participantSetKey(participants) {
  return (participants || [])
    .map((person) => String(person?.id ?? ''))
    .filter((id) => id.length > 0)
    .sort()
    .join('|')
}

/** Stable id:cents signature. Null unless every share has an id and cents. */
export function quoteSignatureFromShares(shares) {
  const parts = []
  for (const share of shares || []) {
    const cents = normalizeCents(share?.share_cents ?? share?.fare_cents)
    if (!share?.id || cents == null) return null
    parts.push(`${String(share.id)}:${cents}`)
  }
  if (!parts.length) return null
  return parts.sort().join('|')
}

/**
 * Quote written onto friend_rides.fare_breakdown.friend_quote when the server prices a ride.
 * @returns {object | null}
 */
export function buildFriendQuote({ rideId, participants, now, id } = {}) {
  const createdMs = clockMs(now)
  if (!rideId || createdMs == null) return null
  const shares = []
  for (const person of participants || []) {
    const cents = normalizeCents(person?.fare_cents)
    if (!person?.id || cents == null || cents < 0) return null
    shares.push({ id: String(person.id), share_cents: cents })
  }
  const signature = quoteSignatureFromShares(shares)
  if (!signature) return null
  return {
    id: id || randomUUID(),
    ride_id: String(rideId),
    shares,
    signature,
    participant_set: participantSetKey(participants),
    created_at: new Date(createdMs).toISOString(),
    expires_at: new Date(createdMs + FRIEND_QUOTE_TTL_MS).toISOString(),
  }
}

export function storedFriendQuote(ride) {
  const quote = ride?.fare_breakdown?.friend_quote
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return null
  return quote
}

/**
 * Quote id and signature from the request. Amount fields are not read.
 */
export function clientQuoteRef(body) {
  const source = body && typeof body === 'object' ? body : {}
  return {
    quoteId: firstScalar(source, QUOTE_ID_KEYS),
    signature: firstScalar(source, QUOTE_SIGNATURE_KEYS),
  }
}

function firstScalar(source, keys) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

/**
 * Charge the stored quote, or send the ride back for review.
 * Does not read client amounts. `now` is the server clock in ms.
 * No quote id charges a fresh stored quote with reason `legacy_no_quote_id`.
 * A quote id that does not match, or a signature that does not match, requires review.
 */
export function evaluateFriendQuote({ ride, participants, quoteId, signature, now } = {}) {
  const quote = storedFriendQuote(ride)
  if (!quote?.id) return { action: 'review', reason: 'missing' }
  if (!quote.ride_id || String(quote.ride_id) !== String(ride?.id || '')) {
    return { action: 'review', reason: 'ride_mismatch' }
  }
  const quotedId = quoteId == null || String(quoteId).trim() === '' ? null : String(quoteId)
  if (quotedId && quotedId !== String(quote.id)) {
    return { action: 'review', reason: 'quote_mismatch' }
  }
  if (signature && String(quote.signature || '') !== String(signature)) {
    return { action: 'review', reason: 'signature_mismatch' }
  }

  const createdMs = Date.parse(quote.created_at)
  const expiresMs = Date.parse(quote.expires_at)
  const at = clockMs(now)
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || at == null) {
    return { action: 'review', reason: 'expired' }
  }
  const ttlEnd = createdMs + FRIEND_QUOTE_TTL_MS
  if (expiresMs - createdMs > FRIEND_QUOTE_TTL_MS || at > expiresMs || at > ttlEnd) {
    return { action: 'review', reason: 'expired' }
  }

  const currentSet = participantSetKey(participants)
  const quotedSet = quote.participant_set || participantSetKey(quote.shares || [])
  const shareSet = participantSetKey(quote.shares || [])
  if (!currentSet || currentSet !== quotedSet || currentSet !== shareSet) {
    return { action: 'review', reason: 'participants_changed' }
  }
  for (const share of quote.shares || []) {
    const cents = normalizeCents(share?.share_cents)
    if (cents == null || cents < 0) return { action: 'review', reason: 'missing' }
  }
  if (!quotedId) {
    return { action: 'charge', reason: 'legacy_no_quote_id', quote, shares: quote.shares }
  }
  return { action: 'charge', quote, shares: quote.shares }
}

/** Replace each participant fare with the stored quoted share. Other fields stay. */
export function applyQuotedShares(participants, quote) {
  const byId = new Map()
  for (const share of quote?.shares || []) {
    const cents = normalizeCents(share?.share_cents)
    if (share?.id && cents != null) byId.set(String(share.id), cents)
  }
  return (participants || []).map((person) => {
    const cents = byId.get(String(person.id))
    if (cents == null) return { ...person }
    return { ...person, fare_cents: cents }
  })
}

export function quotedTotalCents(quote) {
  return (quote?.shares || []).reduce((sum, share) => sum + (normalizeCents(share?.share_cents) || 0), 0)
}

/**
 * Charge a fresh quote, or recompute and require review. `recompute` and `charge` are injected.
 * Client amount fields on `body` are ignored. `now` is the server clock.
 */
export async function settleFriendQuote({
  ride,
  participants,
  body,
  now,
  recompute,
  charge,
} = {}) {
  const ref = clientQuoteRef(body)
  const decision = evaluateFriendQuote({
    ride,
    participants,
    quoteId: ref.quoteId,
    signature: ref.signature,
    now,
  })
  if (decision.action === 'charge') {
    const priced = applyQuotedShares(participants, decision.quote)
    const total = quotedTotalCents(decision.quote)
    if (!total || priced.some((person) => person.fare_cents == null)) {
      return { status: 'fares_missing', reason: decision.reason || null, quote: decision.quote, participants: priced }
    }
    if (decision.reason === 'legacy_no_quote_id') {
      console.info('[confirm-charges] legacy_no_quote_id', {
        rideId: ride?.id || null,
        quoteId: decision.quote?.id || null,
      })
    }
    if (typeof charge !== 'function') throw new Error('charge is required')
    const charged = await charge({
      ride: { ...ride, total_fare_cents: total },
      participants: priced,
      quote: decision.quote,
    })
    return {
      status: 'charged',
      reason: decision.reason || null,
      quote: decision.quote,
      participants: priced,
      charged,
    }
  }
  if (typeof recompute !== 'function') throw new Error('recompute is required')
  const repriced = await recompute({ reason: decision.reason })
  if (!repriced || repriced.ok === false) {
    return { status: 'reprice_failed', reason: decision.reason, recompute: repriced || null }
  }
  const nextRide = repriced.ride || null
  const quote = storedFriendQuote(nextRide) || repriced.quote || null
  return {
    status: 'review_required',
    reason: decision.reason,
    quote,
    ride: nextRide,
    participants: repriced.participants || null,
  }
}
