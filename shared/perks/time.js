/** America/New_York calendar helpers for driver perks. */
export const PERKS_TIME_ZONE = 'America/New_York'

export function nyDayOf(at) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: PERKS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Previous calendar day for a YYYY-MM-DD string. */
export function prevDay(day) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Monday 00:00 America/New_York of the week containing `now`, as a YYYY-MM-DD day. */
export function nyWeekStartDay(now = new Date()) {
  let day = nyDayOf(now)
  for (let i = 0; i < 7; i += 1) {
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 1) return day
    day = prevDay(day)
  }
  return day
}
