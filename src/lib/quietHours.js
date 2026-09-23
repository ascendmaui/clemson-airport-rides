export const DEFAULT_QUIET = {
  dnd: false,
  scheduleEnabled: false,
  start: '22:00',
  end: '07:00',
}

function hhmm(value, fallback) {
  return /^\d{2}:\d{2}$/.test(value || '') ? value : fallback
}

export function quietFromPrefs(raw) {
  const q = raw?.quiet && typeof raw.quiet === 'object' ? raw.quiet : {}
  return {
    dnd: Boolean(q.dnd),
    scheduleEnabled: Boolean(q.scheduleEnabled),
    start: hhmm(q.start, DEFAULT_QUIET.start),
    end: hhmm(q.end, DEFAULT_QUIET.end),
  }
}

function toMinutes(hhmmValue) {
  const [h, m] = String(hhmmValue).split(':').map((n) => Number(n))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

/** Off-the-clock switch, or the clock is inside the quiet window (wraps overnight). */
export function isQuietNow(prefs, now = new Date()) {
  const q = quietFromPrefs(prefs)
  if (q.dnd) return true
  if (!q.scheduleEnabled) return false
  const mins = now.getHours() * 60 + now.getMinutes()
  const start = toMinutes(q.start)
  const end = toMinutes(q.end)
  if (start === end) return true
  if (start < end) return mins >= start && mins < end
  return mins >= start || mins < end
}
