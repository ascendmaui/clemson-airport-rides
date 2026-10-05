/**
 * Rider-facing copy for scheduled weekend and party rides.
 * Passenger count is a display and capacity label only. It is not a fare input.
 * The weekend window matches surge pricing: Friday 17:00 through Sunday,
 * America/New_York. Monday 00:00 is outside.
 */

export const SCHEDULE_PARTY_SEAT_CAP = 4

export const WEEKEND_WINDOW_COPY =
  'Friday 5:00 PM through Sunday, Eastern time. Airport (GSP, CLT, or ATL) and campus use the same confirm step. Drivers see these in the Weekend filter. Schedule at least 30 minutes ahead.'

export const PARTY_FARE_COPY =
  'Passenger count does not change the server fare. The 10% schedule-ahead discount still applies only when the pickup is at least 30 minutes ahead.'

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Integer passenger count from the request; default 1. Prefer passengers over partySize. */
export function passengerCount(body) {
  const raw = body?.passengers ?? body?.partySize ?? body?.party_size
  if (raw == null || raw === '') return 1
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

function countFrom(countOrBody) {
  if (countOrBody != null && typeof countOrBody === 'object') return passengerCount(countOrBody)
  return passengerCount({ passengers: countOrBody })
}

/** "1 passenger" or "4 passengers". Invalid values display as 1 passenger. */
export function passengerCountLabel(countOrBody) {
  const n = countFrom(countOrBody)
  return n === 1 ? '1 passenger' : `${n} passengers`
}

/**
 * Count shown on the web stepper. Values above the seat cap clamp to the cap
 * so the control cannot book more seats than Standard, Wait & Save, and Extra Comfort.
 * The stored request parser is passengerCount, which does not clamp.
 */
export function displayedPassengers(value, cap = SCHEDULE_PARTY_SEAT_CAP) {
  const n = countFrom(value)
  return Math.min(cap, n)
}

/** One step on the passenger control. Stays inside 1..cap. */
export function stepPassengers(current, direction, cap = SCHEDULE_PARTY_SEAT_CAP) {
  const n = displayedPassengers(current, cap)
  if (direction === 'up') return Math.min(cap, n + 1)
  if (direction === 'down') return Math.max(1, n - 1)
  return n
}

/**
 * Party size versus the 4 seats on Standard, Wait & Save, and Extra Comfort.
 * Over-cap copy does not change the stored count or the fare.
 */
export function partyCapacityMessage(countOrBody) {
  const n = countFrom(countOrBody)
  const label = passengerCountLabel(n)
  const cap = SCHEDULE_PARTY_SEAT_CAP
  if (n > cap) {
    return `${label}. That is over the ${cap}-seat cap for Standard, Wait & Save, and Extra Comfort.`
  }
  if (n === cap) {
    return `${label}. That fills a Standard, Wait & Save, or Extra Comfort car (${cap} seats).`
  }
  return `${label}. Standard, Wait & Save, and Extra Comfort seat ${cap}.`
}

export function weekendWindowCopy() {
  return WEEKEND_WINDOW_COPY
}

export function partyFareCopy() {
  return PARTY_FARE_COPY
}

/** Friday 17:00 through Sunday 23:59 America/New_York. */
export function isScheduleWeekendWindow(iso) {
  const date = new Date(iso)
  if (iso == null || iso === '' || Number.isNaN(date.getTime())) return false
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const bag = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  const weekday = WEEKDAY_INDEX[bag.weekday]
  const minute = Number(bag.minute)
  if (weekday == null || !Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const minutes = hour * 60 + minute
  if (weekday === 6 || weekday === 0) return true
  return weekday === 5 && minutes >= 17 * 60
}

export function weekendWindowNote(iso) {
  if (iso == null || iso === '') {
    return 'Choose a pickup time. The weekend window is Friday 5:00 PM through Sunday, Eastern time.'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return 'Choose a valid pickup time. The weekend window is Friday 5:00 PM through Sunday, Eastern time.'
  }
  if (isScheduleWeekendWindow(iso)) {
    return 'This pickup is inside the weekend window: Friday 5:00 PM through Sunday, Eastern time.'
  }
  return 'This pickup is outside the weekend window (Friday 5:00 PM through Sunday, Eastern time). You can still schedule it.'
}
