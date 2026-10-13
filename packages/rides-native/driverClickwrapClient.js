import { authedJson } from './apiClient.js'
import {
  CLICKWRAP_STORAGE_KEY,
  DRIVER_CLICKWRAP_VERSION,
  loadDriverClickwrapPhase,
} from '../../shared/driverClickwrap.js'

export { CLICKWRAP_STORAGE_KEY, DRIVER_CLICKWRAP_VERSION, loadDriverClickwrapPhase }

export async function fetchClickwrapStatus(supabase) {
  return authedJson(supabase, '/api/driver?action=clickwrap')
}

export async function submitDriverClickwrap(supabase, { appVersion } = {}) {
  return authedJson(supabase, '/api/driver?action=clickwrap', {
    method: 'POST',
    body: {
      agreementVersion: DRIVER_CLICKWRAP_VERSION,
      appVersion: appVersion || null,
    },
  })
}

export async function resolveDriverClickwrap(supabase, storage) {
  return loadDriverClickwrapPhase({
    storage,
    fetchStatus: () => fetchClickwrapStatus(supabase),
  })
}
