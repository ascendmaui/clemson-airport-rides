import {
  asComfortSide,
  noComfortMatchMessage,
  womenOnlyMismatchMessage,
  womenOnlyPairAllowed,
} from '../shared/womenOnlyMatch.js'

const MISSING_COLUMN = /column|schema cache|gender_identity|women_only/i

async function readSide(sb, userId) {
  if (!userId) return { row: null, unavailable: false, error: null }
  const res = await sb
    .from('profiles')
    .select('id, gender_identity, women_only_matching')
    .eq('id', userId)
    .maybeSingle()
  if (res.error && MISSING_COLUMN.test(res.error.message || '')) {
    return { row: null, unavailable: true, error: null }
  }
  if (res.error) return { row: null, unavailable: false, error: res.error.message || 'Could not read profile' }
  return { row: res.data, unavailable: false, error: null }
}

export async function loadComfortProfiles(sb, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  if (!unique.length) return { rows: [], unavailable: false, error: null }
  const rich = await sb.from('profiles').select('id, email, gender_identity, women_only_matching').in('id', unique)
  if (rich.error && MISSING_COLUMN.test(rich.error.message || '')) {
    const basic = await sb.from('profiles').select('id, email').in('id', unique)
    if (basic.error) return { rows: [], unavailable: true, error: basic.error.message || 'Could not read drivers' }
    return { rows: basic.data || [], unavailable: true, error: null }
  }
  if (rich.error) return { rows: [], unavailable: false, error: rich.error.message || 'Could not read drivers' }
  return { rows: rich.data || [], unavailable: false, error: null }
}

export async function comfortDecision(sb, riderId, driverId) {
  const rider = await readSide(sb, riderId)
  if (rider.error) return { ok: false, status: 500, error: rider.error, code: 'comfort_preference_unavailable' }
  const driver = await readSide(sb, driverId)
  if (driver.error) return { ok: false, status: 500, error: driver.error, code: 'comfort_preference_unavailable' }
  if (rider.unavailable || driver.unavailable) return { ok: true, unavailable: true }
  const message = womenOnlyMismatchMessage(rider.row, driver.row)
  if (message) return { ok: false, status: 409, error: message, code: 'women_only_mismatch' }
  return { ok: true }
}

export function filterAssignableDrivers(drivers, riderRow, { comfortKnown = true } = {}) {
  const list = drivers || []
  if (!comfortKnown) {
    return { drivers: list, womenOnlyBlocked: false, riderWantsWomenDrivers: false }
  }
  const riderSide = asComfortSide(riderRow)
  const allowed = list.filter((driver) => womenOnlyPairAllowed(riderSide, driver))
  return {
    drivers: allowed,
    womenOnlyBlocked: list.length > 0 && allowed.length === 0,
    riderWantsWomenDrivers: riderSide.womenOnlyMatching,
  }
}

export function comfortEmptyMessage(result) {
  return noComfortMatchMessage({ riderWants: result?.riderWantsWomenDrivers })
}
