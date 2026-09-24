/**
 * Friend-ride fare preview before confirm-charges.
 * The share is participant.fare_cents (what confirm charges).
 * Struck solo and savings come only from fare_breakdown.friend_split
 * when that stored share still matches fare_cents. No local quote.
 */

function centsOrNull(value) {
  if (value == null || value === '') return null
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? n : null
}

export function friendSplitPreview(ride) {
  const empty = { rows: [], totalCents: null, splitMode: null, eachCents: null, headline: null }
  if (!ride || ride.kind === 'carpool') return empty

  const stored = Array.isArray(ride.fare_breakdown?.friend_split?.shares)
    ? ride.fare_breakdown.friend_split.shares
    : []
  const byId = new Map(stored.filter(Boolean).map((row) => [String(row.id), row]))
  const rows = []

  for (const person of ride.participants || []) {
    const shareCents = centsOrNull(person?.fare_cents)
    if (shareCents == null || shareCents < 0) continue
    const extra = byId.get(String(person.id))
    const storedShare = centsOrNull(extra?.share_cents)
    const storedSolo = centsOrNull(extra?.solo_cents)
    const showSolo = storedShare === shareCents && storedSolo != null && storedSolo > shareCents
    rows.push({
      id: String(person.id),
      name: person.display_name || 'Rider',
      shareCents,
      soloCents: showSolo ? storedSolo : null,
      savingsCents: showSolo ? storedSolo - shareCents : null,
    })
  }

  const eachCents = rows.length > 0 && rows.every((row) => row.shareCents === rows[0].shareCents)
    ? rows[0].shareCents
    : null
  const uniform = rows.length > 0 && rows.every((row) => (
    row.soloCents != null
    && row.savingsCents != null
    && row.soloCents === rows[0].soloCents
    && row.shareCents === rows[0].shareCents
  ))

  return {
    rows,
    totalCents: centsOrNull(ride.total_fare_cents),
    splitMode: ride.split_mode === 'by_distance' ? 'by_distance' : 'even',
    eachCents,
    headline: uniform
      ? {
          soloCents: rows[0].soloCents,
          shareCents: rows[0].shareCents,
          savingsCents: rows[0].savingsCents,
        }
      : null,
  }
}

/** A reviewed quote is honored for this long before confirm re-prices it. */
export const FRIEND_REVIEW_TTL_MS = 10 * 60 * 1000

/** Stable id:fare signature. Null unless every participant has a server fare. */
export function friendQuoteSignature(ride) {
  const people = ride?.participants || []
  if (!people.length) return null
  const parts = []
  for (const person of people) {
    const cents = centsOrNull(person?.fare_cents)
    if (cents == null) return null
    parts.push(`${String(person.id)}:${cents}`)
  }
  return parts.sort().join('|')
}

/** Record that the organizer has now seen this server quote. */
export function markFriendQuoteReviewed(ride, now = Date.now()) {
  const signature = friendQuoteSignature(ride)
  return signature ? { signature, at: now } : null
}

/**
 * True when the quote on screen is the one the organizer was just asked to review.
 * The next confirm sends that server quote id and skips another client re-price.
 * At most one review round.
 */
export function reviewedFriendQuoteFresh(review, ride, now = Date.now()) {
  if (!review?.signature) return false
  if (!(now - review.at >= 0 && now - review.at <= FRIEND_REVIEW_TTL_MS)) return false
  return friendQuoteSignature(ride) === review.signature
}

/** True when the quote on screen is not the quote confirm would charge. */
export function friendChargeNeedsReview(shown, refreshed) {
  if (!refreshed) return true
  if (refreshed.kind === 'carpool' || shown?.kind === 'carpool') return false
  const next = refreshed.participants || []
  if (!next.length || next.some((person) => centsOrNull(person?.fare_cents) == null)) return true
  const prev = new Map((shown?.participants || []).map((person) => [String(person.id), centsOrNull(person.fare_cents)]))
  if (prev.size !== next.length) return true
  return next.some((person) => prev.get(String(person.id)) !== centsOrNull(person.fare_cents))
}

/** Quote id the confirm request may send. Amounts stay on the server. */
export function friendQuoteRef(ride) {
  const quote = ride?.fare_breakdown?.friend_quote
  if (!quote?.id) return null
  return {
    quoteId: String(quote.id),
    quoteSignature: quote.signature ? String(quote.signature) : null,
  }
}

/**
 * Put a review_required payload on the lobby. Server shares and quote id win.
 * Top-level amount fields on the payload are ignored.
 */
export function applyFriendChargeReview(shown, payload) {
  const merged = payload?.ride ? (mergeFriendQuote(shown, payload.ride) || shown || null) : (shown || null)
  if (!merged) return null
  const shares = Array.isArray(payload?.shares) ? payload.shares : null
  const quoteId = scalar(payload?.quoteId) || scalar(payload?.quote_id) || scalar(merged?.fare_breakdown?.friend_quote?.id)
  const quoteSignature = scalar(payload?.quoteSignature)
    || scalar(payload?.quote_signature)
    || scalar(merged?.fare_breakdown?.friend_quote?.signature)
  let participants = merged.participants || []
  if (shares?.length) {
    const byId = new Map(shares.map((row) => [String(row.id), centsOrNull(row.share_cents)]))
    participants = participants.map((person) => {
      const cents = byId.get(String(person.id))
      if (cents == null || cents < 0) return person
      return { ...person, fare_cents: cents }
    })
  }
  const previous = merged.fare_breakdown?.friend_quote || {}
  const friend_quote = quoteId
    ? {
        ...previous,
        id: quoteId,
        signature: quoteSignature,
        shares: shares || previous.shares || null,
      }
    : (previous.id ? previous : null)
  return {
    ...merged,
    participants,
    fare_breakdown: {
      ...(merged.fare_breakdown || {}),
      ...(friend_quote ? { friend_quote } : {}),
    },
  }
}

function scalar(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Keep organizer/self flags when a recompute payload omits them. Fares come from refreshed. */
export function mergeFriendQuote(shown, refreshed) {
  if (!refreshed) return shown || null
  const prevById = new Map((shown?.participants || []).map((person) => [String(person.id), person]))
  return {
    ...shown,
    ...refreshed,
    is_organizer: refreshed.is_organizer ?? shown?.is_organizer,
    is_driver: refreshed.is_driver ?? shown?.is_driver,
    viewer_id: refreshed.viewer_id ?? shown?.viewer_id,
    participants: (refreshed.participants || shown?.participants || []).map((person) => {
      const prev = prevById.get(String(person.id))
      if (!prev) return person
      return { ...person, is_self: person.is_self ?? prev.is_self }
    }),
  }
}
