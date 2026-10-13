/** Driver app access to shared/campusEvents.js plus a small loader. */
import { upcomingEvents, activeBonusWindow } from '../../shared/campusEvents.js'
export { EVENT_KIND_LABELS, upcomingEvents, activeBonusWindow, eventDemandWeight, nudgeCopy, bonusLine } from '../../shared/campusEvents.js'

export const CAMPUS_EVENT_COLUMNS = 'id, kind, title, event_date, ends_on, starts_at, zone, demand_weight, active, driver_bonus_cents, bonus_starts_at, bonus_ends_at'

/** Upcoming rows for the driver Discover card. Never throws. */
export async function loadCampusEvents(supabase, { now = new Date(), days = 14 } = {}) {
  if (!supabase) return { events: [], bonus: null }
  const from = new Date(new Date(now).getTime() - 86400000 * 6).toISOString().slice(0, 10)
  const { data, error } = await supabase.from('clemson_events').select(CAMPUS_EVENT_COLUMNS)
    .eq('active', true).gte('event_date', from).order('event_date', { ascending: true }).limit(40)
  if (error || !Array.isArray(data)) return { events: [], bonus: null }
  return { events: upcomingEvents(data, now, days), bonus: activeBonusWindow(data, now) }
}
