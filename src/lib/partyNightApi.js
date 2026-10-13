import { authedJson } from './apiClient.js'
import { supabase } from './supabase.js'

export function partyNightRequest(action, body = {}) {
  return authedJson(supabase, `/api/party-night?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    body,
  })
}
