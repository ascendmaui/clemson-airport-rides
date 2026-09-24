import { quoteCarpool } from './carpool.js'

export function quoteFromRide(ride) {
  const shares = ride?.fare_breakdown?.carpool?.shares
  if (Array.isArray(shares) && shares.length) return ride.fare_breakdown.carpool
  return null
}

/** Server quote when the lobby has one, otherwise the same engine the web lobby uses. */
export function liveCarpoolQuote(ride) {
  const stored = quoteFromRide(ride)
  if (stored) return stored
  const riders = (ride?.participants || [])
    .filter((row) => row?.pickup?.lat != null && row?.dropoff?.lat != null)
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      pickup: row.pickup,
      dropoff: row.dropoff,
    }))
  if (!riders.length) return null
  return quoteCarpool({ riders })
}

export function splitRows(ride) {
  const quote = liveCarpoolQuote(ride)
  if (quote?.shares?.length) {
    return quote.shares.map((share) => ({
      id: String(share.id),
      name: share.firstName || 'Rider',
      shareCents: share.shareCents,
      soloCents: share.soloCents,
      savingsCents: share.savingsCents ?? Math.max(0, (share.soloCents || 0) - (share.shareCents || 0)),
      firstRideFree: Boolean(share.firstRideFree),
    }))
  }
  return (ride?.participants || [])
    .filter((row) => row.fare_cents != null)
    .map((row) => ({
      id: String(row.id),
      name: row.display_name || 'Rider',
      shareCents: row.fare_cents,
      soloCents: null,
      savingsCents: null,
    }))
}

export function selfParticipantId(ride) {
  const self = (ride?.participants || []).find((row) => row.is_self)
  return self?.id || null
}
