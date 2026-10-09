import { randomUUID } from 'node:crypto'

const CLAIM_TTL_MS = 2 * 60 * 1000

export function completionResult(trip, actor, override = false) {
  // Authorization must precede even an already-completed response.
  if (!actor?.id || (!override && trip.driver_id !== actor.id)) {
    return { http: 403, body: { error: 'Only the assigned driver can complete this trip', code: 'forbidden' } }
  }
  if (trip.status === 'completed') {
    return { http: 200, body: { ok: true, idempotent: true, progressed: false, status: 'completed' } }
  }
  if (trip.status !== 'in_progress') {
    return { http: 409, body: { error: 'Trip must be in progress to complete', code: 'invalid_status', progressed: false, status: trip.status } }
  }
  return null
}

// Match only the claim slot (JSON path filters), not the whole metadata value:
// a full-JSON equality filter would put several KB of metadata in the URL.
function claimMatch(query, previous) {
  return previous?.token
    ? query.eq('metadata->completion_claim->>token', previous.token)
    : query.is('metadata->completion_claim', null)
}

const busy = () => ({ http: 409, body: { error: 'Trip completion is already in progress. Refresh and retry.', code: 'completion_in_progress', progressed: false } })
const failed = (error) => ({ http: 500, body: { error: error.message, progressed: false } })

export async function claimCompletion(sb, tripId, actor, override) {
  if (!sb) return { result: { http: 503, body: { error: 'Trip settlement unavailable' } } }
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
    if (read.error) return { result: failed(read.error) }
    const trip = read.data
    if (!trip) return { result: { http: 404, body: { error: 'Trip not found' } } }
    const result = completionResult(trip, actor, override)
    if (result) return { result }
    const now = Date.now()
    const previous = trip.metadata?.completion_claim
    if (previous && Date.parse(previous.at) > now - CLAIM_TTL_MS) return { result: busy() }
    const claim = { at: new Date(now).toISOString(), by: actor.id, token: randomUUID() }
    const metadata = { ...(trip.metadata || {}), completion_claim: claim }
    // Conditional on the claim slot we read, so two racing completes cannot both
    // win. A loser re-reads the row and observes the winner's claim.
    let query = sb.from('trips').update({ metadata }).eq('id', tripId).eq('status', 'in_progress')
    if (!override) query = query.eq('driver_id', actor.id)
    const saved = await claimMatch(query, previous).select('*').maybeSingle()
    if (saved.error) return { result: failed(saved.error) }
    if (saved.data) return { trip: saved.data, claim }
  }
  return { result: busy() }
}

export async function releaseCompletion(sb, tripId, claim) {
  // Payment collection may have added a hold. Preserve it while clearing only
  // our claim, and never clear a newer owner's claim after the lease expires.
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await sb.from('trips').select('metadata').eq('id', tripId).maybeSingle()
    if (read.error) throw read.error
    if (read.data?.metadata?.completion_claim?.token !== claim.token) return
    const metadata = { ...read.data.metadata }
    delete metadata.completion_claim
    const saved = await claimMatch(sb.from('trips').update({ metadata }).eq('id', tripId), claim).select('id').maybeSingle()
    if (saved.error) throw saved.error
    if (saved.data) return
  }
  throw new Error('Could not release trip completion claim')
}
