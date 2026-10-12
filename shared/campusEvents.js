/**
 * Clemson campus calendar helpers (public.clemson_events).
 *
 * Driver supply only: nudges, a configurable driver bonus window, and a
 * demand weight the forecast / heat peak mode can read. Nothing here changes
 * a rider fare.
 */

export const EVENT_KINDS = Object.freeze([
  'football_home', 'campus_event', 'airport_peak', 'other',
  'move_in', 'move_out', 'graduation', 'academic_break', 'big_event',
])

export const EVENT_KIND_LABELS = Object.freeze({
  football_home: 'Home game',
  campus_event: 'Campus event',
  airport_peak: 'Airport rush',
  other: 'Event',
  move_in: 'Move-in',
  move_out: 'Move-out',
  graduation: 'Graduation',
  academic_break: 'Break travel',
  big_event: 'Big event',
})

const TZ = 'America/New_York'

function tzOffsetMinutes(utcMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - utcMs) / 60000)
}

/** A wall-clock time in Clemson (America/New_York) as a Date. */
export function clemsonInstant(dateStr, hour = 12, minute = 0) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], hour, minute)
  const off = tzOffsetMinutes(guess)
  return new Date(guess - off * 60000)
}

/** When the event effectively starts: starts_at, else noon ET on event_date. */
export function eventAnchor(event) {
  const t = event?.starts_at ? Date.parse(event.starts_at) : NaN
  if (Number.isFinite(t)) return new Date(t)
  return clemsonInstant(event?.event_date, 12, 0)
}

/** True when the pre-event driver nudge is due now and not sent yet. */
export function nudgeDue(event, now = new Date()) {
  if (!event || event.active === false || event.nudge_sent_at) return false
  const anchor = eventAnchor(event)
  if (!anchor) return false
  const lead = Math.max(1, Math.min(168, Number(event.nudge_lead_hours) || 24))
  const nowMs = new Date(now).getTime()
  return nowMs >= anchor.getTime() - lead * 3600000 && nowMs < anchor.getTime()
}

function dayLabel(event) {
  const anchor = eventAnchor(event)
  if (!anchor) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(anchor)
}

function timeLabel(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(t))
}

export function bonusLine(event) {
  const cents = Math.max(0, Math.round(Number(event?.driver_bonus_cents) || 0))
  if (!cents || !event?.bonus_starts_at || !event?.bonus_ends_at) return null
  return `+$${(cents / 100).toFixed(cents % 100 ? 2 : 0)} per completed trip, ${timeLabel(event.bonus_starts_at)}–${timeLabel(event.bonus_ends_at)}`
}

/** Push copy for the pre-event driver nudge. */
export function nudgeCopy(event) {
  const label = EVENT_KIND_LABELS[event?.kind] || 'Event'
  const when = dayLabel(event)
  const time = event?.starts_at ? ` at ${timeLabel(event.starts_at)}` : ''
  const bonus = bonusLine(event)
  return {
    title: `${label}: ${event?.title || 'Busy day'}`.slice(0, 80),
    body: [`${when}${time}. Riders will be looking — plan to be online.`, bonus].filter(Boolean).join(' ').slice(0, 178),
  }
}

/** The bonus window active at `now`, or null. */
export function activeBonusWindow(events, now = new Date()) {
  const t = new Date(now).getTime()
  for (const e of events || []) {
    if (e?.active === false || !(Number(e?.driver_bonus_cents) > 0)) continue
    const a = Date.parse(e.bonus_starts_at)
    const b = Date.parse(e.bonus_ends_at)
    if (Number.isFinite(a) && Number.isFinite(b) && t >= a && t < b) return { event: e, cents: Math.round(Number(e.driver_bonus_cents)), line: bonusLine(e) }
  }
  return null
}

function dateOnly(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Demand multiplier for a Clemson date (forecast / heat peak input). 1 = normal. */
export function eventDemandWeight(events, at = new Date()) {
  const day = dateOnly(new Date(at))
  let weight = 1
  for (const e of events || []) {
    if (e?.active === false) continue
    const start = String(e.event_date || '')
    const end = String(e.ends_on || e.event_date || '')
    if (start && day >= start && day <= end) weight = Math.max(weight, Number(e.demand_weight) || 1)
  }
  return weight
}

/** Upcoming events for the driver card, soonest first. */
export function upcomingEvents(events, now = new Date(), days = 14) {
  const from = dateOnly(new Date(now))
  const to = dateOnly(new Date(new Date(now).getTime() + days * 86400000))
  return (events || [])
    .filter((e) => e?.active !== false && String(e.ends_on || e.event_date) >= from && String(e.event_date) <= to)
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))
    .map((e) => ({ id: e.id, kind: e.kind, label: EVENT_KIND_LABELS[e.kind] || 'Event', title: e.title, day: dayLabel(e), bonus: bonusLine(e) }))
}
