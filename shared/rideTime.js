/** Clemson wall clock for date+time (not host TZ / Vercel UTC). */
export const RIDE_TIME_ZONE = 'America/New_York'

function zonedCivilParts(date, timeZone = RIDE_TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** Offset minutes east of UTC for Instant `date` in `timeZone` (EDT → -240). */
function zonedOffsetMinutes(date, timeZone = RIDE_TIME_ZONE) {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT'
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0))
}

/**
 * Civil Y-M-D H:M:S in `timeZone` → UTC Date.
 * DST: non-existent spring-gap hours → Invalid Date; ambiguous fall-back → first occurrence.
 */
export function zonedCivilToUtc(
  year,
  month,
  day,
  hour,
  minute,
  second = 0,
  timeZone = RIDE_TIME_ZONE,
) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsets = new Set([
    zonedOffsetMinutes(new Date(asUtc - 36 * 3600_000), timeZone),
    zonedOffsetMinutes(new Date(asUtc), timeZone),
    zonedOffsetMinutes(new Date(asUtc + 36 * 3600_000), timeZone),
  ])
  const matches = []
  for (const off of offsets) {
    const instant = asUtc - off * 60_000
    const p = zonedCivilParts(new Date(instant), timeZone)
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    ) {
      matches.push(instant)
    }
  }
  if (matches.length === 0) return new Date(NaN)
  matches.sort((a, b) => a - b)
  return new Date(matches[0])
}

