import { isMidrideEligible } from '../server/midrideFare.js'

/**
 * Rider Cancel on the live-trip screen.
 * Same rule as POST /api/trip-cancel-midride (`isMidrideEligible` + `tripHasStarted`):
 * `in_progress`, or `arriving` / `arrived` only after an `in_progress` trip event.
 * Pre-start arrival stays on the wait-fee flow. Confirm and the fare-hold release
 * stay on the mid-ride cancel endpoint.
 */
export function riderMayCancelMidride(status, started = false) {
  return isMidrideEligible(status, { started: started === true })
}

/** Mirrors server `tripHasStarted`: in_progress, else one `in_progress` trip event. */
export async function loadMidrideStarted(client, trip) {
  const status = trip?.status || ''
  if (status === 'in_progress') return true
  if (status !== 'arriving' && status !== 'arrived') return false
  const tripId = trip?.id
  if (!client || !tripId || typeof client.from !== 'function') return false
  try {
    const { data, error } = await client
      .from('trip_events')
      .select('id')
      .eq('trip_id', tripId)
      .eq('kind', 'in_progress')
      .limit(1)
    if (error) return false
    return Boolean(data?.length)
  } catch {
    return false
  }
}
