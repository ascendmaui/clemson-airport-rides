import { isSeedAdminEmail } from '../../shared/adminAccess.js'

/**
 * Driver incentives — pay math and window matching.
 *
 * Distinct from rider surge (`game_day_events.surge_multiplier`), which changes
 * what the rider pays. This module never reads or writes that multiplier.
 *
 * Platform split (20%):
 *   platform_fee = round(rider_gross * 20 / 100)
 *   driver_net   = rider_gross - platform_fee
 *
 * Incentive basis is driver_net (after the platform fee), not rider gross.
 * The extra is added on top of driver_net and is not charged to the rider.
 * The platform does not take another 20% of the incentive.
 *
 *   multiplier        — N times driver_net (1.5 → driver keeps net + 0.5*net)
 *   bonus_per_ride    — flat cents added per completed trip
 *   hourly_guarantee  — cents per hour of the trip (accepted → completed).
 *                       Tops up only when boosted net is below the pro-rated floor.
 *                       The highest matching guarantee wins; others record $0.
 *
 * Stacking: every matching window applies. Multipliers compound in id order,
 * then bonuses add, then the hourly floor is checked against that subtotal.
 *
 * Windows (America/New_York):
 *   Recurring nights use days_of_week + night_start/night_end (default 19:00–02:00,
 *   wrapping past midnight — 1:30am Friday still counts as Thursday night).
 *   starts_at/ends_at are bounds when weekdays are set.
 *   A row with both timestamps and no weekdays is an admin-scheduled block
 *   (one home game, or any one-off window) and is active for that whole interval.
 *   game_day rows also turn on while a game_day_events row overlaps "now".
 *   That overlap is only a yes/no. The event's surge_multiplier is rider surge.
 */

export const PLATFORM_FEE_PERCENT = 20
export const INCENTIVE_ADMIN_EMAIL = 'john@gmail.com'
export const DEFAULT_TIMEZONE = 'America/New_York'
export const DEFAULT_NIGHT_START = '19:00'
export const DEFAULT_NIGHT_END = '02:00'

export const INCENTIVE_TYPES = ['bonus_per_ride', 'hourly_guarantee', 'multiplier']

export const DOW_LABELS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
]

/** Seeded in supabase/driver_incentives.sql. Thu/Fri/Sat 7pm–2am ET, plus game-day $5. */
export const DEFAULT_WINDOWS = [
  {
    name: 'Thursday night',
    type: 'multiplier',
    value: 1.5,
    days_of_week: [4],
    night_start: DEFAULT_NIGHT_START,
    night_end: DEFAULT_NIGHT_END,
    game_day: false,
    active: true,
    timezone: DEFAULT_TIMEZONE,
  },
  {
    name: 'Friday night',
    type: 'multiplier',
    value: 1.5,
    days_of_week: [5],
    night_start: DEFAULT_NIGHT_START,
    night_end: DEFAULT_NIGHT_END,
    game_day: false,
    active: true,
    timezone: DEFAULT_TIMEZONE,
  },
  {
    name: 'Saturday night',
    type: 'multiplier',
    value: 1.5,
    days_of_week: [6],
    night_start: DEFAULT_NIGHT_START,
    night_end: DEFAULT_NIGHT_END,
    game_day: false,
    active: true,
    timezone: DEFAULT_TIMEZONE,
  },
  {
    name: 'Clemson game day',
    type: 'bonus_per_ride',
    value: 500,
    days_of_week: [],
    night_start: '00:00',
    night_end: '23:59',
    game_day: true,
    active: true,
    timezone: DEFAULT_TIMEZONE,
  },
]

const DOW_BY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function assertNever(type) {
  throw new Error(`Unhandled incentive type: ${type}`)
}

export function isIncentiveAdmin(user, profile) {
  const email = String(profile?.email || user?.email || '').trim().toLowerCase()
  if (email === INCENTIVE_ADMIN_EMAIL) return true
  if (isSeedAdminEmail(email)) return true
  if (profile?.is_admin === true) return true
  const role = profile?.role
  return role === 'admin' || role === 'ops'
}

export function splitFare(grossFareCents) {
  const gross = Math.max(0, Math.round(Number(grossFareCents) || 0))
  const platformFeeCents = Math.round((gross * PLATFORM_FEE_PERCENT) / 100)
  return {
    grossFareCents: gross,
    platformFeeCents,
    driverNetCents: gross - platformFeeCents,
  }
}

export function zonedParts(date, timeZone = DEFAULT_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const bag = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let hour = bag.hour
  if (hour === '24') hour = '00'
  return {
    dow: DOW_BY_SHORT[bag.weekday],
    time: `${hour}:${bag.minute}:${bag.second}`,
    date: `${bag.year}-${bag.month}-${bag.day}`,
  }
}

/** Interpret a datetime-local value as wall time in `timeZone` and return UTC. */
export function zonedLocalToUtc(localValue, timeZone = DEFAULT_TIMEZONE) {
  if (!localValue) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localValue)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(utc, timeZone)
    const [py, pm, pd] = parts.date.split('-').map(Number)
    const [ph, pmin] = parts.time.split(':').map(Number)
    const shown = Date.UTC(py, pm - 1, pd, ph, pmin, 0)
    const intended = Date.UTC(year, month - 1, day, hour, minute, 0)
    const diff = shown - intended
    if (diff === 0) break
    utc = new Date(utc.getTime() - diff)
  }
  return utc
}

export function utcToZonedLocalInput(iso, timeZone = DEFAULT_TIMEZONE) {
  if (!iso) return ''
  const parts = zonedParts(new Date(iso), timeZone)
  return `${parts.date}T${parts.time.slice(0, 5)}`
}

function timeToSeconds(value) {
  const [h, m, s] = String(value || '0').split(':')
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)
}

export function nightWindowMatches(dow, timeStr, days, nightStart, nightEnd) {
  if (!Array.isArray(days) || days.length === 0) return false
  const set = new Set(days.map(Number))
  const t = timeToSeconds(timeStr)
  const start = timeToSeconds(nightStart || DEFAULT_NIGHT_START)
  const end = timeToSeconds(nightEnd || DEFAULT_NIGHT_END)
  if (end > start) return set.has(dow) && t >= start && t < end
  if (t >= start) return set.has(dow)
  if (t < end) return set.has((dow + 6) % 7)
  return false
}

export function incentiveMatches(row, at, { gameDayActive = false } = {}) {
  if (!row || row.active === false) return false
  const when = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(when.getTime())) return false
  if (row.starts_at && when < new Date(row.starts_at)) return false
  if (row.ends_at && when > new Date(row.ends_at)) return false

  const parts = zonedParts(when, row.timezone || DEFAULT_TIMEZONE)
  const days = Array.isArray(row.days_of_week) ? row.days_of_week : []
  const hasDays = days.length > 0
  if (hasDays && nightWindowMatches(parts.dow, parts.time, days, row.night_start, row.night_end)) {
    return true
  }
  if (row.game_day && gameDayActive) return true
  const absolute = Boolean(row.starts_at && row.ends_at && !hasDays)
  if (absolute) return true
  if (!hasDays && !row.game_day && (row.starts_at || row.ends_at)) return true
  return false
}

export function activeIncentives(rows, at, options) {
  return (rows || []).filter((row) => incentiveMatches(row, at, options))
}

export function formatMultiplier(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '1'
  const rounded = Math.round(n * 100) / 100
  return String(rounded)
}

export function formatUsdFromCents(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function incentiveBannerLine(row) {
  switch (row?.type) {
    case 'multiplier':
      return `Tonight: ${formatMultiplier(row.value)}x earnings on all rides`
    case 'bonus_per_ride':
      return `Tonight: +${formatUsdFromCents(row.value)} bonus on every ride`
    case 'hourly_guarantee':
      return `Tonight: ${formatUsdFromCents(row.value)}/hr guaranteed`
    default:
      return assertNever(row?.type)
  }
}

export function activeIncentiveBanner(rows) {
  if (!rows?.length) return ''
  return rows.map((row) => incentiveBannerLine(row)).join(' · ')
}

export function tripDurationHours(startedAt, completedAt) {
  const end = new Date(completedAt).getTime()
  const start = startedAt ? new Date(startedAt).getTime() : end - 60_000
  let secs = (end - start) / 1000
  if (!Number.isFinite(secs) || secs < 60) secs = 60
  return secs / 3600
}

function lineFrom(row, extraCents, driverIncentiveMultiplier) {
  return {
    incentiveId: row.id || null,
    name: row.name,
    type: row.type,
    value: Number(row.value),
    extraCents,
    driverIncentiveMultiplier,
  }
}

/**
 * @param {object} args
 * @param {number} args.grossFareCents rider fare already charged (includes rider surge if any)
 * @param {Array} args.incentives incentives already matched for this completion time
 * @param {string|Date} args.startedAt trip accepted_at
 * @param {string|Date} args.completedAt trip completed_at
 */
export function computeIncentivePayout({
  grossFareCents,
  incentives = [],
  startedAt,
  completedAt,
}) {
  const split = splitFare(grossFareCents)
  const ordered = [...incentives].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
  const lines = []
  let running = split.driverNetCents
  let multiplierProduct = null
  const hourlyRows = []

  for (const row of ordered) {
    switch (row.type) {
      case 'multiplier': {
        const factor = Number(row.value) || 1
        const next = Math.round(running * factor)
        const extra = next - running
        running = next
        multiplierProduct = multiplierProduct == null ? factor : multiplierProduct * factor
        lines.push(lineFrom(row, extra, factor))
        break
      }
      case 'bonus_per_ride': {
        const extra = Math.max(0, Math.round(Number(row.value) || 0))
        lines.push(lineFrom(row, extra, null))
        break
      }
      case 'hourly_guarantee':
        hourlyRows.push(row)
        break
      default:
        assertNever(row.type)
    }
  }

  const bonusExtra = lines
    .filter((line) => line.type === 'bonus_per_ride')
    .reduce((sum, line) => sum + line.extraCents, 0)
  const subtotal = running + bonusExtra
  const hours = tripDurationHours(startedAt, completedAt || new Date())

  if (hourlyRows.length) {
    const ranked = [...hourlyRows].sort((a, b) => {
      const byValue = Number(b.value) - Number(a.value)
      if (byValue !== 0) return byValue
      return String(a.id || '').localeCompare(String(b.id || ''))
    })
    const winner = ranked[0]
    const guarantee = Math.round(Number(winner.value) * hours)
    const topUp = Math.max(0, guarantee - subtotal)
    const hourlyLines = ranked
      .map((row) => lineFrom(row, row === winner ? topUp : 0, null))
      .sort((a, b) => String(a.incentiveId || '').localeCompare(String(b.incentiveId || '')))
    lines.push(...hourlyLines)
  }

  const incentiveExtraCents = lines.reduce((sum, line) => sum + line.extraCents, 0)
  return {
    ...split,
    incentiveExtraCents,
    driverPayoutCents: split.driverNetCents + incentiveExtraCents,
    driverIncentiveMultiplier: multiplierProduct,
    incentiveBasis: 'driver_net',
    hoursOnTrip: hours,
    lines,
  }
}
