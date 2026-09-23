import { supabase } from './supabase'
import {
  activeIncentiveBanner,
  activeIncentives,
  isIncentiveAdmin,
  utcToZonedLocalInput,
  zonedLocalToUtc,
  zonedParts,
} from './driverIncentiveMath'

export { isIncentiveAdmin }

const INCENTIVE_COLS =
  'id, name, type, value, starts_at, ends_at, days_of_week, game_day, active, night_start, night_end, timezone, created_at, updated_at'

async function gameDayActive(at = new Date()) {
  if (!supabase) return false
  const iso = at.toISOString()
  const { data, error } = await supabase
    .from('game_day_events')
    .select('id')
    .eq('active', true)
    .lte('starts_at', iso)
    .gte('ends_at', iso)
    .limit(1)
  if (error) return false
  return Boolean(data?.length)
}

export async function fetchActiveIncentiveState(at = new Date()) {
  if (!supabase) return { rows: [], banner: '', gameDayActive: false }
  const [{ data, error }, gameOn] = await Promise.all([
    supabase.from('driver_incentives').select(INCENTIVE_COLS).eq('active', true),
    gameDayActive(at),
  ])
  if (error) {
    console.error('[driver_incentives]', error.message)
    return { rows: [], banner: '', gameDayActive: gameOn, error: error.message }
  }
  let rows = []
  try {
    rows = activeIncentives(data || [], at, { gameDayActive: gameOn })
  } catch (err) {
    console.error('[driver_incentives] match', err)
  }
  let banner = ''
  try {
    banner = activeIncentiveBanner(rows)
  } catch (err) {
    console.error('[driver_incentives] banner', err)
    banner = rows.length ? 'Tonight: driver incentive on' : ''
  }
  return { rows, banner, gameDayActive: gameOn }
}

export async function recordIncentivePresence(driverId, rows, at = new Date()) {
  if (!supabase || !driverId || !rows?.length) return
  const seenOn = zonedParts(at).date
  const payload = rows.map((row) => ({
    incentive_id: row.id,
    driver_id: driverId,
    seen_on: seenOn,
  }))
  const { error } = await supabase
    .from('incentive_presence')
    .upsert(payload, { onConflict: 'incentive_id,driver_id,seen_on', ignoreDuplicates: true })
  if (error) console.error('[incentive_presence]', error.message)
}

export async function applyTripDriverIncentives(tripId) {
  if (!supabase || !tripId) return { ok: false, reason: 'unavailable' }
  const { data, error } = await supabase.rpc('apply_trip_driver_incentives', { p_trip_id: tripId })
  if (error) return { ok: false, reason: error.message }
  return { ok: true, result: data }
}

export async function fetchDriverIncentiveExtras(driverId, tripIds) {
  if (!supabase || !driverId || !tripIds?.length) return {}
  const { data, error } = await supabase
    .from('incentive_payouts')
    .select('trip_id, extra_cents')
    .eq('driver_id', driverId)
    .in('trip_id', tripIds)
  if (error) {
    console.error('[incentive_payouts]', error.message)
    return {}
  }
  const byTrip = {}
  for (const row of data || []) {
    byTrip[row.trip_id] = (byTrip[row.trip_id] || 0) + (Number(row.extra_cents) || 0)
  }
  return byTrip
}

export async function fetchAllIncentives() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('driver_incentives')
    .select(INCENTIVE_COLS)
    .order('name')
  if (error) throw new Error(error.message)
  return data || []
}

export function formToIncentivePayload(form, { createdBy } = {}) {
  const days = (form.days_of_week || []).map(Number).sort((a, b) => a - b)
  const tz = form.timezone || 'America/New_York'
  const payload = {
    name: String(form.name || '').trim(),
    type: form.type,
    value: Number(form.value),
    days_of_week: days,
    game_day: Boolean(form.game_day),
    active: form.active !== false,
    night_start: form.night_start || '19:00',
    night_end: form.night_end || '02:00',
    timezone: tz,
    starts_at: form.starts_local ? zonedLocalToUtc(form.starts_local, tz)?.toISOString() || null : null,
    ends_at: form.ends_local ? zonedLocalToUtc(form.ends_local, tz)?.toISOString() || null : null,
  }
  if (createdBy) payload.created_by = createdBy
  return payload
}

export async function saveIncentive(form, { id, createdBy } = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  const entered = Number(form.value)
  const storedValue = form.type === 'multiplier' ? entered : Math.round(entered * 100)
  const payload = formToIncentivePayload(
    { ...form, value: storedValue },
    { createdBy: id ? undefined : createdBy },
  )
  if (!payload.name) throw new Error('Name is required')
  if (!Number.isFinite(payload.value) || payload.value < 0) throw new Error('Value must be zero or more')
  if (payload.type === 'multiplier' && payload.value < 1) throw new Error('Multiplier must be at least 1')
  const hasDays = payload.days_of_week.length > 0
  const hasWindow = Boolean(payload.starts_at && payload.ends_at)
  if (!hasDays && !payload.game_day && !hasWindow) {
    throw new Error('Pick weeknights, mark a game day, or set a start and end')
  }
  if (id) {
    const { data, error } = await supabase
      .from('driver_incentives')
      .update(payload)
      .eq('id', id)
      .select(INCENTIVE_COLS)
      .single()
    if (error) throw new Error(error.message)
    return data
  }
  const { data, error } = await supabase
    .from('driver_incentives')
    .insert(payload)
    .select(INCENTIVE_COLS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteIncentive(id) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('driver_incentives').delete().eq('id', id)
  if (!error) return { deleted: true }
  const { error: offError } = await supabase
    .from('driver_incentives')
    .update({ active: false })
    .eq('id', id)
  if (offError) throw new Error(error.message)
  return { deleted: false, deactivated: true }
}

export async function fetchIncentiveReport() {
  if (!supabase) throw new Error('Supabase is not configured')
  const [incentivesRes, payoutsRes, presenceRes] = await Promise.all([
    supabase.from('driver_incentives').select(INCENTIVE_COLS).order('name'),
    supabase
      .from('incentive_payouts')
      .select('id, incentive_id, trip_id, driver_id, extra_cents, incentive_type, applied_at')
      .order('applied_at', { ascending: false })
      .limit(500),
    supabase.from('incentive_presence').select('incentive_id, driver_id, seen_on'),
  ])
  if (incentivesRes.error) throw new Error(incentivesRes.error.message)
  if (payoutsRes.error) throw new Error(payoutsRes.error.message)
  if (presenceRes.error) throw new Error(presenceRes.error.message)

  const payouts = payoutsRes.data || []
  const presence = presenceRes.data || []
  const rows = (incentivesRes.data || []).map((incentive) => {
    const mine = payouts.filter((p) => p.incentive_id === incentive.id)
    const seen = presence.filter((p) => p.incentive_id === incentive.id)
    return {
      ...incentive,
      trips: new Set(mine.map((p) => p.trip_id)).size,
      driversPaid: new Set(mine.map((p) => p.driver_id)).size,
      extraCents: mine.reduce((sum, p) => sum + (Number(p.extra_cents) || 0), 0),
      driversOnline: new Set(seen.map((p) => p.driver_id)).size,
    }
  })
  const tripIds = new Set(payouts.map((p) => p.trip_id))
  const driverIds = new Set(payouts.map((p) => p.driver_id))
  return {
    rows,
    recent: payouts.slice(0, 20),
    totals: {
      trips: tripIds.size,
      driversPaid: driverIds.size,
      extraCents: payouts.reduce((sum, p) => sum + (Number(p.extra_cents) || 0), 0),
      driversOnline: new Set(presence.map((p) => p.driver_id)).size,
    },
  }
}

export function blankIncentiveForm() {
  return {
    name: '',
    type: 'multiplier',
    value: '1.5',
    days_of_week: [4],
    game_day: false,
    active: true,
    night_start: '19:00',
    night_end: '02:00',
    timezone: 'America/New_York',
    starts_local: '',
    ends_local: '',
  }
}

export function incentiveToForm(row) {
  const tz = row.timezone || 'America/New_York'
  return {
    name: row.name || '',
    type: row.type,
    value: row.type === 'multiplier'
      ? String(Number(row.value))
      : (Number(row.value) / 100).toFixed(2),
    days_of_week: Array.isArray(row.days_of_week) ? row.days_of_week.map(Number) : [],
    game_day: Boolean(row.game_day),
    active: row.active !== false,
    night_start: String(row.night_start || '19:00').slice(0, 5),
    night_end: String(row.night_end || '02:00').slice(0, 5),
    timezone: tz,
    starts_local: row.starts_at ? utcToZonedLocalInput(row.starts_at, tz) : '',
    ends_local: row.ends_at ? utcToZonedLocalInput(row.ends_at, tz) : '',
  }
}
