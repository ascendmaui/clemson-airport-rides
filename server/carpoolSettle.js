/**
 * Game-day lookup, first-ride eligibility, and post-book ledgers.
 * No import from friendRideLib — that file calls back into here.
 */
import {
  AMBASSADOR_CENTS_PER_SEAT,
  AMBASSADOR_CODE_TYPE,
  FIRST_RIDE_CODE_TYPE,
  firstRideWindowOpen,
} from '../src/lib/carpoolEngine.js'

function missingTable(error) {
  return /relation|does not exist|schema cache/i.test(error?.message || '')
}

export async function gameDayActive(sb, at = new Date()) {
  if (!sb) return false
  const iso = at.toISOString()
  const { data, error } = await sb
    .from('game_day_events')
    .select('id')
    .eq('active', true)
    .lte('starts_at', iso)
    .gte('ends_at', iso)
    .limit(1)
  if (error || !data?.length) return false
  return true
}

/** At most one comp per pool. One grant per user, and no completed trips. */
export async function eligibleFirstRideIds(sb, participants, at = new Date(), { gameDay = false } = {}) {
  if (!sb || !firstRideWindowOpen(at, { gameDay })) return []
  for (const participant of participants || []) {
    if (!participant?.user_id || !participant?.id) continue
    const grant = await sb
      .from('first_ride_grants')
      .select('user_id')
      .eq('user_id', participant.user_id)
      .maybeSingle()
    if (grant.error) {
      if (missingTable(grant.error)) return []
      continue
    }
    if (grant.data) continue
    if (participant.email) {
      const byEmail = await sb
        .from('first_ride_grants')
        .select('user_id')
        .eq('email_norm', String(participant.email).toLowerCase())
        .maybeSingle()
      if (byEmail.data) continue
    }
    const prior = await sb
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('rider_id', participant.user_id)
      .eq('status', 'completed')
    if (prior.error) continue
    if ((prior.count || 0) > 0) continue
    return [participant.id]
  }
  return []
}

export async function settleCarpoolSideEffects(sb, { ride, trip, participants }) {
  const quote = ride?.fare_breakdown?.carpool
  if (!sb || !quote) return { ok: true, skipped: true }
  const results = {}
  const free = (quote.shares || []).find((share) => share.firstRideFree)
  if (free) {
    const part = (participants || []).find((p) => p.id === free.id)
    if (part?.user_id) {
      const { error } = await sb.from('first_ride_grants').insert({
        user_id: part.user_id,
        email_norm: part.email ? String(part.email).toLowerCase() : null,
        trip_id: trip?.id || null,
        friend_ride_id: ride.id,
        code_type: FIRST_RIDE_CODE_TYPE,
      })
      results.firstRide = error ? error.message : 'granted'
    }
  }
  const code = ride?.fare_breakdown?.ambassador_code
  if (code && trip?.id) {
    const seats = (participants || []).length
    const { error } = await sb.from('ambassador_payout_ledger').insert({
      code,
      code_type: AMBASSADOR_CODE_TYPE,
      trip_id: trip.id,
      friend_ride_id: ride.id,
      seats,
      amount_cents: seats * AMBASSADOR_CENTS_PER_SEAT,
      status: 'pending',
    })
    results.ambassador = error ? error.message : 'ledgered'
  }
  return { ok: true, results }
}
