/**
 * Tell the server this app is still open on a trip. Failures stay quiet:
 * a missed beat must not interrupt the ride, and a crash simply stops the beat.
 */
import { authedJson } from './apiClient.js'

export function sendTripHeartbeat(supabase, tripId) {
  if (!supabase || !tripId) return Promise.resolve(null)
  return authedJson(supabase, '/api/driver?action=trip-status', {
    method: 'POST',
    body: { tripId, op: 'heartbeat' },
  }).catch(() => null)
}
