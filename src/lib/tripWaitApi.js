import { supabase } from './supabase.js'
import { authedJson } from './apiClient.js'

/**
 * Server transition for the pickup wait clock.
 * @param {'arrive'|'tick'|'cancel'|'start'|'complete'} action
 */
export async function tripWaitAction(action, tripId, options = {}) {
  return authedJson(supabase, '/api/driver?action=wait', {
    method: 'POST',
    body: { action, tripId },
    fetch: options?.fetch,
    headers: options?.headers,
  })
}
