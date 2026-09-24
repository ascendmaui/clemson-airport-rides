/** Period buckets for the driver earnings details screen. */

export type EarningsPeriod = 'day' | 'week' | 'month' | 'year'

export type EarningTrip = {
  id: string
  status?: string
  fare_cents?: number
  completed_at?: string | null
  pickup_label?: string | null
  dropoff_label?: string | null
}

export type EarningBar = {
  key: string
  label: string
  cents: number
}

export type PeriodReport = {
  label: string
  previousLabel: string
  nextLabel: string
  totalCents: number
  youCents: number
  platformCents: number
  completed: number
  canceled: number
  bars: EarningBar[]
}

const ZONE = 'America/New_York'

type Zoned = {
  year: number
  month: number
  day: number
  hour: number
  weekday: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function driverNetCents(fareCents: number): number {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const fee = Math.round(fare * 0.2)
  return fare - fee
}

function zoned(date: Date, timeZone = ZONE): Zoned {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const bag: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value
  const weekday = WEEKDAYS.indexOf(bag.weekday || 'Sun')
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    weekday: weekday < 0 ? 0 : weekday,
  }
}

function sameDay(a: Zoned, b: Zoned): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

function startOfWeek(parts: Zoned): { year: number; month: number; day: number } {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day)
  const shifted = new Date(utc - parts.weekday * 86400000)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function weekKey(parts: Zoned): string {
  const start = startOfWeek(parts)
  return `${start.year}-${start.month}-${start.day}`
}

function monthKey(parts: Zoned): string {
  return `${parts.year}-${parts.month}`
}

function inRange(tripParts: Zoned, anchor: Zoned, period: EarningsPeriod): boolean {
  switch (period) {
    case 'day':
      return sameDay(tripParts, anchor)
    case 'week':
      return weekKey(tripParts) === weekKey(anchor)
    case 'month':
      return monthKey(tripParts) === monthKey(anchor)
    case 'year':
      return tripParts.year === anchor.year
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

function shortDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 16))
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric' }).format(date)
}

function monthName(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 15, 16))
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'long' }).format(date)
}

function addDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + delta))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

export function shiftAnchor(period: EarningsPeriod, anchor: Date, direction: -1 | 1): Date {
  const parts = zoned(anchor)
  const next = new Date(anchor.getTime())
  switch (period) {
    case 'day':
      next.setDate(next.getDate() + direction)
      return next
    case 'week':
      next.setDate(next.getDate() + direction * 7)
      return next
    case 'month':
      next.setMonth(next.getMonth() + direction)
      return next
    case 'year':
      next.setFullYear(parts.year + direction)
      return next
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

function periodCopy(period: EarningsPeriod, anchor: Zoned): { label: string; previousLabel: string; nextLabel: string } {
  switch (period) {
    case 'day': {
      const date = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day, 16))
      const label = new Intl.DateTimeFormat('en-US', {
        timeZone: ZONE,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }).format(date)
      const prev = addDays(anchor.year, anchor.month, anchor.day, -1)
      const next = addDays(anchor.year, anchor.month, anchor.day, 1)
      return {
        label,
        previousLabel: shortDate(prev.year, prev.month, prev.day),
        nextLabel: shortDate(next.year, next.month, next.day),
      }
    }
    case 'week': {
      const start = startOfWeek(anchor)
      const end = addDays(start.year, start.month, start.day, 6)
      const prev = addDays(start.year, start.month, start.day, -7)
      const next = addDays(start.year, start.month, start.day, 7)
      return {
        label: `${shortDate(start.year, start.month, start.day)} – ${shortDate(end.year, end.month, end.day)}`,
        previousLabel: shortDate(prev.year, prev.month, prev.day),
        nextLabel: shortDate(next.year, next.month, next.day),
      }
    }
    case 'month': {
      const prevMonth = anchor.month === 1 ? 12 : anchor.month - 1
      const nextMonth = anchor.month === 12 ? 1 : anchor.month + 1
      const prevYear = anchor.month === 1 ? anchor.year - 1 : anchor.year
      const nextYear = anchor.month === 12 ? anchor.year + 1 : anchor.year
      return {
        label: monthName(anchor.year, anchor.month),
        previousLabel: monthName(prevYear, prevMonth).slice(0, 3),
        nextLabel: monthName(nextYear, nextMonth).slice(0, 3),
      }
    }
    case 'year':
      return {
        label: String(anchor.year),
        previousLabel: String(anchor.year - 1),
        nextLabel: String(anchor.year + 1),
      }
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

function emptyBars(period: EarningsPeriod, anchor: Zoned): EarningBar[] {
  switch (period) {
    case 'day':
      return [
        { key: 'night', label: 'Night', cents: 0 },
        { key: 'morning', label: 'AM', cents: 0 },
        { key: 'afternoon', label: 'Mid', cents: 0 },
        { key: 'evening', label: 'PM', cents: 0 },
      ]
    case 'week': {
      const start = startOfWeek(anchor)
      return WEEKDAYS.map((label, index) => {
        const day = addDays(start.year, start.month, start.day, index)
        return { key: `${day.month}-${day.day}`, label: label.slice(0, 1), cents: 0 }
      })
    }
    case 'month': {
      const firstWeekday = new Date(Date.UTC(anchor.year, anchor.month - 1, 1)).getUTCDay()
      const days = new Date(Date.UTC(anchor.year, anchor.month, 0)).getUTCDate()
      const bars: EarningBar[] = []
      let cursor = 1
      let index = 0
      while (cursor <= days) {
        const span = index === 0 ? 7 - firstWeekday : 7
        const end = Math.min(days, cursor + span - 1)
        bars.push({
          key: `w${index}`,
          label: `${anchor.month}/${cursor}`,
          cents: 0,
        })
        cursor = end + 1
        index += 1
      }
      return bars
    }
    case 'year':
      return ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((label, index) => ({
        key: `m${index + 1}`,
        label,
        cents: 0,
      }))
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

function barIndex(period: EarningsPeriod, trip: Zoned, anchor: Zoned, bars: EarningBar[]): number {
  switch (period) {
    case 'day':
      if (trip.hour < 6) return 0
      if (trip.hour < 12) return 1
      if (trip.hour < 18) return 2
      return 3
    case 'week':
      return trip.weekday
    case 'month': {
      const firstWeekday = new Date(Date.UTC(anchor.year, anchor.month - 1, 1)).getUTCDay()
      let cursor = 1
      for (let index = 0; index < bars.length; index += 1) {
        const span = index === 0 ? 7 - firstWeekday : 7
        if (trip.day >= cursor && trip.day < cursor + span) return index
        cursor += span
      }
      return bars.length - 1
    }
    case 'year':
      return trip.month - 1
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

export function reportPeriod(
  trips: EarningTrip[] | null | undefined,
  period: EarningsPeriod,
  anchor: Date,
): PeriodReport {
  const anchorParts = zoned(anchor)
  const copy = periodCopy(period, anchorParts)
  const bars = emptyBars(period, anchorParts)
  let totalCents = 0
  let youCents = 0
  let platformCents = 0
  let completed = 0
  let canceled = 0

  for (const trip of trips || []) {
    if (!trip.completed_at) continue
    const when = new Date(trip.completed_at)
    if (Number.isNaN(when.getTime())) continue
    const parts = zoned(when)
    if (!inRange(parts, anchorParts, period)) continue
    if (trip.status === 'canceled') {
      canceled += 1
      continue
    }
    if (trip.status && trip.status !== 'completed') continue
    completed += 1
    const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
    const net = driverNetCents(fare)
    const fee = Math.max(0, fare - net)
    totalCents += net
    youCents += net
    platformCents += fee
    const index = barIndex(period, parts, anchorParts, bars)
    const bar = bars[index]
    if (bar) bar.cents += net
  }

  return {
    ...copy,
    totalCents,
    youCents,
    platformCents,
    completed,
    canceled,
    bars,
  }
}

export function currentWeekLabel(now = new Date()): string {
  return reportPeriod([], 'week', now).label
}

export type TipPayment = {
  kind?: string
  amountCents?: number
  amount_cents?: number
  status?: string
}

export function tipCentsFromPayments(payments: TipPayment[] | null | undefined): number {
  return (payments || []).reduce((sum, payment) => {
    if (String(payment.kind) !== 'tip') return sum
    const status = String(payment.status || 'succeeded')
    if (/fail|refund|cancel/i.test(status)) return sum
    return sum + Math.max(0, Math.round(Number(payment.amountCents ?? payment.amount_cents) || 0))
  }, 0)
}

export function straightLineMiles(
  from: { latitude: number; longitude: number } | null,
  to: { latitude: number; longitude: number } | null,
): number | null {
  if (!from || !to) return null
  const rad = Math.PI / 180
  const dLat = (to.latitude - from.latitude) * rad
  const dLng = (to.longitude - from.longitude) * rad
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2
  const miles = 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  if (!Number.isFinite(miles)) return null
  return Math.round(miles * 100) / 100
}
