/**
 * Loads the game-day experience from the client Supabase session.
 * Missing optional tables (driver zone config, campus calendar) are ignored.
 */
import { buildGameDayExperience } from '../../shared/gameDayExperience.js'

export {
  buildGameDayExperience,
  GAME_DAY_ORANGE,
  GAME_DAY_PURPLE,
} from '../../shared/gameDayExperience.js'

async function readRows(supabase, table, apply) {
  try {
    let query = supabase.from(table).select('*')
    if (apply) query = apply(query)
    const { data, error } = await query
    if (error) return { ok: false, rows: [] }
    return { ok: true, rows: Array.isArray(data) ? data : [] }
  } catch {
    return { ok: false, rows: [] }
  }
}

export async function loadGameDaySources(supabase, { driverId = null, now = new Date() } = {}) {
  if (!supabase) {
    return {
      events: [],
      calendarEvents: [],
      zones: null,
      windows: null,
      prepItems: null,
      checkedIds: [],
      queue: null,
      surgeConfig: null,
    }
  }

  const events = await readRows(supabase, 'game_day_events', (query) => query.eq('active', true).limit(50))
  const zones = await readRows(supabase, 'game_day_zones', (query) => query.eq('active', true).limit(50))
  const windows = await readRows(supabase, 'game_day_zone_windows', (query) => query.eq('active', true).limit(20))
  const prep = await readRows(supabase, 'game_day_prep_items', (query) => query.eq('active', true).limit(20))
  const calendar = await readRows(supabase, 'clemson_events', (query) => query.eq('active', true).limit(40))
  const config = await readRows(supabase, 'driver_perk_config', (query) => query.eq('key', 'game_day_surge').limit(1))

  const surgeRow = config.ok ? config.rows[0] : null
  const surgeConfig = surgeRow && surgeRow.value && typeof surgeRow.value === 'object' ? surgeRow.value : null
  const partial = {
    events: events.ok ? events.rows : [],
    calendarEvents: calendar.ok ? calendar.rows : [],
    zones: zones.ok ? zones.rows : null,
    windows: windows.ok ? windows.rows : null,
    prepItems: prep.ok ? prep.rows : null,
    checkedIds: [],
    queue: null,
    surgeConfig,
  }
  const anchorId = buildGameDayExperience({ ...partial, now }).eventId
  if (!anchorId) return partial

  const snap = await readRows(supabase, 'game_day_pickup_queue', (query) => query.eq('event_id', anchorId).limit(1))
  if (snap.ok) partial.queue = snap.rows[0] || null
  if (driverId) {
    const checks = await readRows(supabase, 'game_day_prep_checks', (query) => (
      query.eq('driver_id', driverId).eq('event_id', anchorId).limit(20)
    ))
    if (checks.ok) partial.checkedIds = checks.rows.map((row) => row.item_id).filter(Boolean)
  }
  return partial
}

export async function loadGameDayExperience(supabase, options = {}) {
  const sources = await loadGameDaySources(supabase, options)
  return { sources, model: buildGameDayExperience({ ...sources, now: options.now }) }
}

export async function setGameDayPrepCheck(supabase, { driverId, eventId, itemId, checked }) {
  if (!supabase || !driverId || !eventId || !itemId) return { ok: false, persisted: false, error: null }
  try {
    if (checked) {
      const { error } = await supabase.from('game_day_prep_checks').upsert({
        driver_id: driverId,
        event_id: eventId,
        item_id: itemId,
        checked_at: new Date().toISOString(),
      }, { onConflict: 'driver_id,event_id,item_id' })
      return { ok: !error, persisted: !error, error: error?.message || null }
    }
    const { error } = await supabase
      .from('game_day_prep_checks')
      .delete()
      .eq('driver_id', driverId)
      .eq('event_id', eventId)
      .eq('item_id', itemId)
    return { ok: !error, persisted: !error, error: error?.message || null }
  } catch (err) {
    return { ok: false, persisted: false, error: err instanceof Error ? err.message : 'Could not save prep' }
  }
}
