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
