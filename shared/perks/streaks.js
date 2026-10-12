/**
 * Streak bonuses. Pure: callers pass the driver's trip history.
 * - Trip streak: consecutive completed trips with no driver cancel in between.
 * - Day streak: consecutive America/New_York days with at least one completed trip.
 * Each time a streak reaches a multiple of N, one bonus is earned. The ledger
 * ref makes awarding idempotent.
 */
import { nyDayOf, prevDay } from './time.js'

export const DEFAULT_STREAK_CONFIG = {
  enabled: true,
  trips: { enabled: true, target: 10, bonusCents: 1000 },
  days: { enabled: true, target: 5, bonusCents: 1500 },
}

export function normalizeStreakConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const part = (p, d) => {
    const x = p && typeof p === 'object' ? p : {}
    const target = Math.max(1, Math.round(Number(x.target ?? d.target) || d.target))
    const bonusCents = Math.max(0, Math.round(Number(x.bonusCents ?? d.bonusCents) || 0))
    return { enabled: x.enabled !== false, target, bonusCents }
  }
  return {
    enabled: c.enabled !== false,
    // Streak points reached before this instant never pay (no retroactive bonuses).
    startsAt: c.startsAt && Number.isFinite(Date.parse(c.startsAt)) ? Date.parse(c.startsAt) : Number.POSITIVE_INFINITY,
    trips: part(c.trips, DEFAULT_STREAK_CONFIG.trips),
    days: part(c.days, DEFAULT_STREAK_CONFIG.days),
  }
}

function eventsOf(trips, driverId) {
  const events = []
  for (const t of trips || []) {
    if (t?.metadata?.e2e_test === true) continue
    if (t.status === 'completed' && t.driver_id === driverId && t.completed_at) {
      events.push({ at: Date.parse(t.completed_at), kind: 'done', tripId: t.id })
    }
    for (const c of Array.isArray(t?.metadata?.driver_cancels) ? t.metadata.driver_cancels : []) {
      if (c?.driver_id === driverId && c.at) events.push({ at: Date.parse(c.at), kind: 'cancel', tripId: t.id })
    }
  }
  return events.filter((e) => Number.isFinite(e.at)).sort((a, b) => a.at - b.at)
}

/** Current trip streak and every award point reached in history. */
export function tripStreak(trips, driverId, target) {
  let run = 0
  const awards = []
  for (const e of eventsOf(trips, driverId)) {
    if (e.kind === 'cancel') { run = 0; continue }
    run += 1
    if (target > 0 && run % target === 0) awards.push({ ref: `trip:${e.tripId}`, tripId: e.tripId, length: run, at: e.at })
  }
  return { current: run, awards }
}

/** Current day streak (alive if the last trip day is today or yesterday) and award points. */
export function dayStreak(trips, driverId, target, now = new Date()) {
  const days = [...new Set(eventsOf(trips, driverId).filter((e) => e.kind === 'done').map((e) => nyDayOf(e.at)))].sort()
  let run = 0
  let last = null
  const awards = []
  const lastAt = new Map()
  for (const e of eventsOf(trips, driverId)) if (e.kind === 'done') lastAt.set(nyDayOf(e.at), e.at)
  for (const day of days) {
    run = last && prevDay(day) === last ? run + 1 : 1
    last = day
    if (target > 0 && run % target === 0) awards.push({ ref: `days:${day}`, day, length: run, at: lastAt.get(day) })
  }
  const today = nyDayOf(now)
  const alive = last === today || last === prevDay(today)
  return { current: alive ? run : 0, awards }
}

export function streakProgress(trips, driverId, rawConfig, now = new Date()) {
  const config = normalizeStreakConfig(rawConfig)
  const t = tripStreak(trips, driverId, config.trips.target)
  const d = dayStreak(trips, driverId, config.days.target, now)
  const view = (s, part) => ({
    enabled: config.enabled && part.enabled,
    current: s.current,
    target: part.target,
    toNext: part.target - (s.current % part.target),
    progress: (s.current % part.target) / part.target,
    bonusCents: part.bonusCents,
  })
  const awards = []
  if (config.enabled && config.trips.enabled && config.trips.bonusCents > 0) {
    for (const a of t.awards) if (a.at >= config.startsAt) awards.push({ kind: 'streak_trips', ref: a.ref, amountCents: config.trips.bonusCents, tripId: a.tripId })
  }
  if (config.enabled && config.days.enabled && config.days.bonusCents > 0) {
    for (const a of d.awards) if (a.at >= config.startsAt) awards.push({ kind: 'streak_days', ref: a.ref, amountCents: config.days.bonusCents })
  }
  return { trips: view(t, config.trips), days: view(d, config.days), awards }
}
