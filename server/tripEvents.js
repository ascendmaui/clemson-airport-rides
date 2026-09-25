/**
 * trip_events audit-log writes. Failed inserts used to be ignored at several
 * call sites (scheduleTrip, tripSettle, midride cancel, driver accept, …),
 * so ops had no signal when the ledger drifted from trip status. Always log
 * and return the error so callers can surface it.
 */

export async function insertTripEvent(sb, { trip_id: tripId, kind, payload } = {}) {
  if (!sb) {
    const error = { message: 'supabase client required' }
    console.error('[trip_events]', kind || 'unknown', error.message)
    return { data: null, error }
  }
  if (!tripId) {
    const error = { message: 'trip_id required' }
    console.error('[trip_events]', kind || 'unknown', error.message)
    return { data: null, error }
  }
  const row = { trip_id: tripId, kind, payload }
  const { data, error } = await sb.from('trip_events').insert(row)
  if (error) {
    console.error('[trip_events]', kind || 'unknown', error.message || String(error))
  }
  return { data: data ?? null, error: error || null }
}
