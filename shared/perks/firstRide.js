/**
 * First completed trip of each America/New_York calendar day.
 * Canceled trips and e2e harness trips never count. The ledger ref is
 * `<driverId>:<YYYY-MM-DD>`, so a driver earns this at most once a day.
 * Completions before config.startsAt never pay.
 */
import { nyDayOf } from './time.js'

export const DEFAULT_FIRST_RIDE_DAILY = {
  enabled: true,
  bonusCents: 500,
}

export function normalizeFirstRideConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const bonusCents = Math.max(0, Math.round(Number(c.bonusCents ?? DEFAULT_FIRST_RIDE_DAILY.bonusCents) || 0))
  return {
    enabled: c.enabled !== false,
    startsAt: c.startsAt && Number.isFinite(Date.parse(c.startsAt)) ? Date.parse(c.startsAt) : Number.POSITIVE_INFINITY,
    bonusCents,
  }
}

export function formatPerkDollars(cents) {
  const n = Math.round(Number(cents) || 0)
  const abs = Math.abs(n)
  const body = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2)
  return `${n < 0 ? '-' : ''}$${body}`
}

function completionAt(trip) {
  const at = Date.parse(trip?.completed_at)
  return Number.isFinite(at) ? at : null
}

/** Earliest qualifying completion per NY day for this driver. */
export function firstCompletionsByDay(trips, driverId) {
  const best = new Map()
  for (const trip of trips || []) {
    if (!trip || trip.driver_id !== driverId) continue
    if (trip.status !== 'completed') continue
    if (trip.canceled_at) continue
    if (trip.metadata?.e2e_test === true) continue
    const at = completionAt(trip)
    if (at == null) continue
    const day = nyDayOf(at)
    if (!day) continue
    const prev = best.get(day)
    if (!prev || at < prev.at || (at === prev.at && String(trip.id) < String(prev.tripId))) {
      best.set(day, { day, at, tripId: trip.id })
    }
  }
  return [...best.values()].sort((a, b) => (a.at - b.at) || String(a.tripId).localeCompare(String(b.tripId)))
}

export function firstRideDaily(trips, driverId, rawConfig, now = new Date()) {
  const config = normalizeFirstRideConfig(rawConfig)
  const today = nyDayOf(now)
  const firsts = firstCompletionsByDay(trips, driverId)
  const open = config.enabled && config.bonusCents > 0 && Number.isFinite(config.startsAt) && now.getTime() >= config.startsAt
  const awards = []
  if (open) {
    for (const first of firsts) {
      if (first.at < config.startsAt) continue
      awards.push({
        kind: 'first_ride_daily',
        ref: `${driverId}:${first.day}`,
        amountCents: config.bonusCents,
        tripId: first.tripId,
        metadata: { day: first.day },
      })
    }
  }
  const todayFirst = firsts.find((first) => first.day === today) || null
  const earned = Boolean(open && todayFirst && todayFirst.at >= config.startsAt)
  const available = Boolean(open && !todayFirst)
  return {
    enabled: config.enabled && config.bonusCents > 0,
    bonusCents: config.bonusCents,
    today,
    earned,
    available,
    awards,
  }
}

/** Home chip. Null when the bonus is off, or today's first ride already happened before it started. */
export function firstRideChipCopy(view) {
  if (!view?.enabled || (!view.earned && !view.available)) return null
  return {
    title: `First ride today: +${formatPerkDollars(view.bonusCents)}`,
    line: view.earned ? 'Earned' : 'Still available',
    tone: view.earned ? 'orange' : 'purple',
  }
}
