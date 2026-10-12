/**
 * Driver quiet hours window, always on Clemson time (America/New_York),
 * whatever the phone's or the server's clock zone is. Shared by the driver
 * app (offer banner / buzz / local notification) and the server (offer push).
 */

export const QUIET_TIME_ZONE = 'America/New_York'

const HHMM = /^(\d{2}):(\d{2})$/

export function parseHhmm(value) {
  const match = HHMM.exec(typeof value === 'string' ? value : '')
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

export function formatHhmm(minutes) {
  const total = ((Math.round(Number(minutes) || 0) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** "22:00" → "10:00 PM". */
export function hhmmLabel(value) {
  const mins = parseHhmm(value)
  if (mins == null) return value || ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** Minutes after midnight in America/New_York (DST-aware via Intl). */
export function minutesInZone(now = new Date(), timeZone = QUIET_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  const h = hour === 24 ? 0 : hour
  if (!Number.isFinite(h) || !Number.isFinite(minute)) return 0
  return h * 60 + minute
}

/**
 * True when `nowMinutes` is inside [start, end). Windows that cross midnight
 * (start > end, e.g. 22:00–07:00) wrap. start === end means all day.
 */
export function inWindow(nowMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return true
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes
  return nowMinutes >= startMinutes || nowMinutes < endMinutes
}

/**
 * quiet = { dnd, scheduleEnabled, start: 'HH:MM', end: 'HH:MM' } (profiles.notification_prefs.quiet).
 * DND is always quiet; otherwise only when the schedule is on and NY time is inside the window.
 */
export function isQuietAt(quiet, now = new Date()) {
  if (!quiet || typeof quiet !== 'object') return false
  if (quiet.dnd) return true
  if (!quiet.scheduleEnabled) return false
  const start = parseHhmm(quiet.start)
  const end = parseHhmm(quiet.end)
  if (start == null || end == null) return false
  return inWindow(minutesInZone(now), start, end)
}
