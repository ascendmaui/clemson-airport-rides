/**
 * Push one notice to a list of drivers through their saved Expo tokens.
 * Used by supply nudges (campus events, airport arrival waves). Never used
 * for ride offers. Callers pass already-filtered driver ids.
 */
import { sendExpoPush } from './expoPush.js'

export async function pushDrivers(sb, driverIds, { title, body, data, channelId = 'driver-supply' } = {}, deps = {}) {
  const ids = [...new Set((driverIds || []).filter(Boolean))]
  const result = { sent: 0, failed: 0, drivers: ids.length }
  if (!ids.length) return result
  const { data: tokens, error } = await sb.from('driver_push_tokens').select('driver_id, token').in('driver_id', ids)
  if (error) throw new Error(error.message || 'Could not load driver push tokens')
  const send = deps.sendExpoPush || sendExpoPush
  for (const row of tokens || []) {
    const out = await send({ to: row.token, title, body, data, channelId }, deps)
    if (out?.sent) result.sent += 1
    else result.failed += 1
  }
  return result
}

/** Approved driver ids (profiles.role = driver and an approved application). */
export async function approvedDriverIds(sb, { limit = 500 } = {}) {
  const { data, error } = await sb.from('driver_applications')
    .select('profile_id, status')
    .eq('status', 'approved')
    .limit(limit)
  if (error) throw new Error(error.message || 'Could not load drivers')
  return (data || []).map((row) => row.profile_id).filter(Boolean)
}
