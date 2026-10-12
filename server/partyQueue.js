import { loadPerkConfig } from './perks.js'
import { partyQueueBoost, partyQueueView } from '../shared/perks/partyQueue.js'

async function members(sb) {
  const res = await sb.from('driver_perk_prefs').select('driver_id, party_queue_joined_at').eq('party_queue_opt_in', true).limit(500)
  if (res.error) return []
  return (res.data || []).map((r) => ({ driverId: r.driver_id, joinedAt: r.party_queue_joined_at }))
}

export async function partyExtraBoost(sb, pickup, now = new Date()) {
  if (!pickup) return null
  const config = await loadPerkConfig(sb, 'party_queue', null)
  if (!config) return null
  return partyQueueBoost(pickup, await members(sb), config, now)
}

export async function partyQueueSummary(sb, driverId, now = new Date()) {
  const config = await loadPerkConfig(sb, 'party_queue', {})
  const list = (await members(sb)).sort((a, b) => Date.parse(a.joinedAt || 0) - Date.parse(b.joinedAt || 0))
  const idx = list.findIndex((m) => m.driverId === driverId)
  return partyQueueView(config, { optedIn: idx >= 0, position: idx >= 0 ? idx + 1 : null, size: list.length }, now)
}

export async function setPartyQueueOptIn(sb, driverId, on) {
  const res = await sb.from('driver_perk_prefs').upsert({
    driver_id: driverId, party_queue_opt_in: Boolean(on),
    party_queue_joined_at: on ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }, { onConflict: 'driver_id' })
  if (res.error) throw new Error(res.error.message)
  return { ok: true, optedIn: Boolean(on) }
}
