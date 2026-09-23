/**
 * Driver earnings.
 *
 * Today: completed trips whose completed_at falls on the driver's local calendar day.
 * This week: Monday 00:00 through next Monday 00:00 in that timezone (Mon–Sun).
 * Driver net per trip: (gross fare − succeeded refunds) − 20% platform fee + tips + wait fees.
 *   Gross fare is fare_cents. If that is 0, succeeded non-tip payments are the gross.
 *   The 20% fee is applied to the fare after refunds, per trip (rounded to the cent).
 *   Tips are not reduced by the platform fee. Wait fees are included only when a trip
 *   stores wait_fee_cents / metadata.wait_fee_cents / metadata.wait_cents.
 * Today / this week / the ride list all use that driver net.
 * Projected week (estimate): week so far + (daily pace × days still left after today).
 *   Pace is this week's net ÷ days elapsed (Mon = 1 … Sun = 7).
 *   When the 28 days before this Monday also have trips, pace is
 *   70% this-week pace + 30% (those nets ÷ 28).
 *   A quiet week with older trips uses that 28-day average alone.
 * Tips: trips.tip_cents when the column is present, else metadata.tip_cents,
 *   else succeeded payments with kind "tip". Hidden on the week cards when none exist.
 *   The year-end summary always has a tip line (amount, or "not tracked").
 * Distance: metadata.distance_m or ride_bills.distance_m (routed). Otherwise
 *   straight-line meters between the original coordinates, labeled approximate.
 *   Those original coordinates are not returned to the UI.
 * Duration: metadata/ride_bills duration_s, else completed_at − accepted_at.
 * Year-end tax summary: calendar year in the driver's timezone, same net formula.
 *   It is a records summary, not an official IRS form.
 *
 * Client queries are limited to trips the signed-in driver owns (RLS).
 * Payments and ride_bills are not driver-readable; optional extras come from
 * GET /api/driver-earnings, which checks the caller and returns aggregates only.
 */
import { supabase } from './supabase.js'
import {
  approximateLatLng,
  displayFirstName,
  maskCompletedTripForDriver,
  maskedRouteSummary,
} from './privacyDisplay.js'

const TRIP_BASE = [
  'id',
  'rider_id',
  'status',
  'fare_cents',
  'deposit_cents',
  'pickup_label',
  'dropoff_label',
  'pickup_lat',
  'pickup_lng',
  'dropoff_lat',
  'dropoff_lng',
  'completed_at',
  'accepted_at',
  'requested_at',
  'metadata',
].join(', ')

const WEEKDAY_MON0 = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SUCCEEDED = new Set(['succeeded', 'paid', 'complete', 'completed'])

/** Applied to fare after refunds. Tips and wait fees are not charged this rate. */
export const PLATFORM_FEE_RATE = 0.2
export const TAX_DISCLAIMER = 'not official IRS form — summary for your records'

export function platformFeeCents(grossAfterRefundCents) {
  return Math.round((Number(grossAfterRefundCents) || 0) * PLATFORM_FEE_RATE)
}

/** @returns {number | null} null when this trip does not record a wait fee */
export function readWaitFeeCents(row) {
  if (row && Object.prototype.hasOwnProperty.call(row, 'wait_fee_cents') && row.wait_fee_cents != null && row.wait_fee_cents !== '') {
    return Math.max(0, Math.round(Number(row.wait_fee_cents) || 0))
  }
  const meta = row?.metadata || {}
  const raw = meta.wait_fee_cents ?? meta.wait_cents
  if (raw != null && raw !== '') return Math.max(0, Math.round(Number(raw) || 0))
  return null
}

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  /** @type {Record<string, string>} */
  const bag = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday,
  }
}

function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - date.getTime()
}

export function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let i = 0; i < 3; i += 1) {
    const next = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs(new Date(utc), timeZone)
    if (next === utc) break
    utc = next
  }
  return new Date(utc)
}

export function startOfZonedDay(date, timeZone) {
  const p = zonedParts(date, timeZone)
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone)
}

export function addZonedDays(dayStart, days, timeZone) {
  const p = zonedParts(dayStart, timeZone)
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return zonedTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), 0, 0, 0, timeZone)
}

export function startOfWeekMonday(date, timeZone) {
  const start = startOfZonedDay(date, timeZone)
  const weekday = WEEKDAY_MON0[zonedParts(date, timeZone).weekday] ?? 0
  return addZonedDays(start, -weekday, timeZone)
}

function inRange(iso, start, end) {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t >= start.getTime() && t < end.getTime()
}

function sumEarned(trips) {
  return trips.reduce((sum, trip) => sum + (Number(trip.earnedCents) || 0), 0)
}

function paymentAmount(payment) {
  const raw = payment?.amountCents ?? payment?.amount_cents
  return Math.max(0, Math.round(Number(raw) || 0))
}

function isSucceeded(payment) {
  return SUCCEEDED.has(String(payment?.status || '').toLowerCase())
}

/**
 * @returns {number | null} null when tips are not tracked on this trip
 */
export function readTipCents(row, payments = []) {
  if (row && Object.prototype.hasOwnProperty.call(row, 'tip_cents') && row.tip_cents != null && row.tip_cents !== '') {
    return Math.max(0, Math.round(Number(row.tip_cents) || 0))
  }
  const metaTip = row?.metadata?.tip_cents
  if (metaTip != null && metaTip !== '') return Math.max(0, Math.round(Number(metaTip) || 0))
  const tips = (payments || []).filter((p) => String(p.kind) === 'tip' && isSucceeded(p))
  if (tips.length) return tips.reduce((sum, p) => sum + paymentAmount(p), 0)
  return null
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function readDistance(row, bill) {
  const billed = Number(bill?.distanceM ?? bill?.distance_m)
  if (Number.isFinite(billed) && billed > 0) return { meters: Math.round(billed), approximate: false }
  const routed = Number(row?.metadata?.distance_m)
  if (Number.isFinite(routed) && routed > 0) return { meters: Math.round(routed), approximate: false }
  const lat1 = Number(row?.pickup_lat)
  const lng1 = Number(row?.pickup_lng)
  const lat2 = Number(row?.dropoff_lat)
  const lng2 = Number(row?.dropoff_lng)
  if ([lat1, lng1, lat2, lng2].every(Number.isFinite)) {
    return { meters: Math.round(haversineMeters(lat1, lng1, lat2, lng2)), approximate: true }
  }
  return { meters: null, approximate: false }
}

export function readDuration(row, bill) {
  const billed = Number(bill?.durationS ?? bill?.duration_s)
  if (Number.isFinite(billed) && billed > 0) return { seconds: Math.round(billed), approximate: false }
  const routed = Number(row?.metadata?.duration_s)
  if (Number.isFinite(routed) && routed > 0) return { seconds: Math.round(routed), approximate: false }
  const end = new Date(row?.completed_at).getTime()
  const start = new Date(row?.accepted_at || row?.requested_at).getTime()
  if (Number.isFinite(end) && Number.isFinite(start)) {
    const seconds = (end - start) / 1000
    if (seconds >= 60 && seconds <= 12 * 3600) return { seconds: Math.round(seconds), approximate: true }
  }
  return { seconds: null, approximate: false }
}

/**
 * Build a driver-safe trip. Precise addresses, polylines, and last names are dropped.
 */
export function sanitizeCompletedTripForDriver(row, { riderName = '', payments = [], bill = null } = {}) {
  const masked = maskCompletedTripForDriver(row) || {}
  const tipCents = readTipCents(row, payments)
  const fareCents = Math.max(0, Math.round(Number(row?.fare_cents) || 0))
  const succeeded = (payments || []).filter(isSucceeded)
  const refunds = succeeded
    .filter((p) => p.kind === 'refund')
    .reduce((sum, p) => sum + paymentAmount(p), 0)
  const collected = succeeded
    .filter((p) => p.kind !== 'refund' && p.kind !== 'tip')
    .reduce((sum, p) => sum + paymentAmount(p), 0)
  const tipValue = tipCents || 0
  const waitFeeCents = readWaitFeeCents(row)
  const grossFareCents = fareCents > 0 ? fareCents : collected
  const refundCents = Math.min(refunds, grossFareCents)
  const fareAfterRefundCents = Math.max(0, grossFareCents - refundCents)
  const feeCents = platformFeeCents(fareAfterRefundCents)
  const netFareCents = fareAfterRefundCents - feeCents
  const earnedCents = netFareCents + tipValue + (waitFeeCents || 0)

  const distance = readDistance(row, bill)
  const duration = readDuration(row, bill)
  const pickup = approximateLatLng(masked.pickup_lat, masked.pickup_lng)
  const dropoff = approximateLatLng(masked.dropoff_lat, masked.dropoff_lng)

  /** @type {{ label: string, cents: number }[]} */
  const fareParts = []
  const base = Number(bill?.baseCents ?? bill?.base_cents) || 0
  const distCents = Number(bill?.distanceCents ?? bill?.distance_cents) || 0
  const timeCents = Number(bill?.timeCents ?? bill?.time_cents) || 0
  const surgeCents = Number(bill?.surgeCents ?? bill?.surge_cents) || 0
  if (base) fareParts.push({ label: 'Base', cents: base })
  if (distCents) fareParts.push({ label: 'Distance charge', cents: distCents })
  if (timeCents) fareParts.push({ label: 'Time', cents: timeCents })
  if (surgeCents) fareParts.push({ label: 'Surge', cents: surgeCents })

  const pickupLabel = masked.pickup_label || 'Trip completed'
  const dropoffLabel = masked.dropoff_label || 'Trip completed'

  return {
    id: row?.id,
    completedAt: row?.completed_at || row?.requested_at || null,
    fareCents: grossFareCents,
    refundCents,
    platformFeeCents: feeCents,
    netFareCents,
    tipCents,
    waitFeeCents,
    earnedCents,
    distanceM: distance.meters,
    distanceApproximate: distance.approximate,
    durationS: duration.seconds,
    durationApproximate: duration.approximate,
    pickupLabel,
    dropoffLabel,
    routeLabel: maskedRouteSummary(pickupLabel, dropoffLabel),
    pickupApprox: pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    dropoffApprox: dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null,
    riderFirstName: displayFirstName(riderName),
    fareParts,
  }
}

export function formatMiles(meters, { approximate = false } = {}) {
  if (meters == null || !Number.isFinite(Number(meters))) return '—'
  const miles = Number(meters) / 1609.344
  const body = miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
  return approximate ? `About ${body}` : body
}

export function formatDuration(seconds, { approximate = false } = {}) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const total = Math.max(0, Math.round(Number(seconds) / 60))
  const body = total < 60
    ? `${total} min`
    : `${Math.floor(total / 60)} h ${total % 60 ? `${total % 60} min` : ''}`.trim()
  return approximate ? `About ${body}` : body
}

export function formatTripWhen(iso, timeZone) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/**
 * @param {ReturnType<typeof sanitizeCompletedTripForDriver>[]} trips
 */
export function summarizeDriverEarnings(trips, { now = new Date(), timeZone = 'America/New_York' } = {}) {
  const list = Array.isArray(trips) ? trips : []
  const weekStart = startOfWeekMonday(now, timeZone)
  const weekEnd = addZonedDays(weekStart, 7, timeZone)
  const todayStart = startOfZonedDay(now, timeZone)
  const todayEnd = addZonedDays(todayStart, 1, timeZone)
  const trailStart = addZonedDays(weekStart, -28, timeZone)

  const todayTrips = list.filter((t) => inRange(t.completedAt, todayStart, todayEnd))
  const weekTrips = list.filter((t) => inRange(t.completedAt, weekStart, weekEnd))
  const trailTrips = list.filter((t) => inRange(t.completedAt, trailStart, weekStart))

  const todayEarningsCents = sumEarned(todayTrips)
  const weekEarningsCents = sumEarned(weekTrips)
  const tipsTracked = list.some((t) => t.tipCents != null)
  const sumTips = (rows) => rows.reduce((sum, t) => sum + (t.tipCents || 0), 0)

  const elapsedDays = (WEEKDAY_MON0[zonedParts(now, timeZone).weekday] ?? 0) + 1
  const remainingDays = 7 - elapsedDays
  const weekPace = weekEarningsCents / elapsedDays
  const trailEarnings = sumEarned(trailTrips)
  const trailPace = trailEarnings / 28
  const trailHas = trailTrips.length > 0

  let pace = 0
  let paceSource = 'no_recent_trips'
  if (weekEarningsCents > 0 && trailHas) {
    pace = 0.7 * weekPace + 0.3 * trailPace
    paceSource = 'week_pace_blended_with_28_day'
  } else if (weekEarningsCents > 0) {
    pace = weekPace
    paceSource = 'this_week_daily_pace'
  } else if (trailHas) {
    pace = trailPace
    paceSource = 'trailing_28_day_daily_average'
  }

  const projectedRemainderCents = Math.max(0, Math.round(pace * remainingDays))
  const projectedWeekCents = weekEarningsCents + projectedRemainderCents

  const days = WEEKDAY_LABELS.map((label, index) => {
    const start = addZonedDays(weekStart, index, timeZone)
    const end = addZonedDays(weekStart, index + 1, timeZone)
    const dayTrips = weekTrips.filter((t) => inRange(t.completedAt, start, end))
    return {
      index,
      label,
      earningsCents: sumEarned(dayTrips),
      tripCount: dayTrips.length,
      isToday: start.getTime() === todayStart.getTime(),
      isFuture: start.getTime() > todayStart.getTime(),
    }
  })

  const rides = [...list].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())

  return {
    timeZone,
    weekStartsOn: 'monday',
    todayEarningsCents,
    todayTripCount: todayTrips.length,
    todayTipsCents: tipsTracked ? sumTips(todayTrips) : null,
    weekEarningsCents,
    weekTripCount: weekTrips.length,
    weekTipsCents: tipsTracked ? sumTips(weekTrips) : null,
    elapsedDays,
    remainingDays,
    projectedRemainderCents,
    projectedWeekCents,
    paceSource,
    estimate: true,
    days,
    rides,
  }
}

export function earningsProgressCopy(summary) {
  if (!summary) return ''
  const { elapsedDays, remainingDays, weekEarningsCents, paceSource } = summary
  if (paceSource === 'no_recent_trips' && !weekEarningsCents) {
    return 'Finish a trip and today’s total shows up here.'
  }
  if (remainingDays === 0) {
    return 'That’s the full week — the total above is what you earned.'
  }
  if (paceSource === 'trailing_28_day_daily_average') {
    return 'No completed trips yet this week. The estimate follows your last 28 days.'
  }
  if (elapsedDays <= 2) {
    return 'Early in the week. The projection is an estimate from your pace.'
  }
  return `${elapsedDays} of 7 days in. The rest of the week is an estimate.`
}

function sumField(trips, field) {
  return trips.reduce((sum, trip) => sum + (Number(trip[field]) || 0), 0)
}

export function taxYears(trips, now = new Date(), timeZone = 'America/New_York') {
  const years = new Set([zonedParts(now, timeZone).year])
  for (const trip of trips || []) {
    if (!trip?.completedAt) continue
    const date = new Date(trip.completedAt)
    if (Number.isNaN(date.getTime())) continue
    years.add(zonedParts(date, timeZone).year)
  }
  return [...years].sort((a, b) => b - a)
}

/**
 * Calendar-year 1099-style summary. Same driver-net formula as the dashboard.
 * Locations on included trips are whatever the caller already sanitized.
 */
export function buildAnnualTaxSummary(trips, { year, timeZone = 'America/New_York' } = {}) {
  const y = Number(year)
  const inYear = (trips || []).filter((trip) => {
    if (!trip?.completedAt) return false
    const date = new Date(trip.completedAt)
    if (Number.isNaN(date.getTime())) return false
    return zonedParts(date, timeZone).year === y
  })
  const tipsTracked = inYear.some((trip) => trip.tipCents != null)
  const waitTracked = inYear.some((trip) => trip.waitFeeCents != null)
  const grossFareCents = sumField(inYear, 'fareCents')
  const refundCents = sumField(inYear, 'refundCents')
  const platformFeeCentsTotal = sumField(inYear, 'platformFeeCents')
  const netFareCents = sumField(inYear, 'netFareCents')
  const tipsCents = tipsTracked ? inYear.reduce((sum, trip) => sum + (trip.tipCents || 0), 0) : null
  const waitFeeCents = waitTracked ? inYear.reduce((sum, trip) => sum + (trip.waitFeeCents || 0), 0) : null
  const driverNetCents = sumField(inYear, 'earnedCents')
  return {
    year: y,
    timeZone,
    tripCount: inYear.length,
    grossFareCents,
    refundCents,
    platformFeeCents: platformFeeCentsTotal,
    platformFeeRate: PLATFORM_FEE_RATE,
    netFareCents,
    tipsCents,
    waitFeeCents,
    driverNetCents,
    disclaimer: TAX_DISCLAIMER,
    trips: [...inYear].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)),
  }
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function csvMoney(cents) {
  return (Number(cents) / 100).toFixed(2)
}

/** CSV download. Trip rows use masked area labels and first names only. */
export function buildAnnualTaxCsv(summary) {
  const tipsCell = summary.tipsCents == null ? 'not tracked' : csvMoney(summary.tipsCents)
  const waitCell = summary.waitFeeCents == null ? 'not tracked' : csvMoney(summary.waitFeeCents)
  const rows = [
    ['Clemson RIDES', 'Driver annual earnings summary'],
    ['Disclaimer', summary.disclaimer],
    ['Year', summary.year],
    ['Timezone', summary.timeZone],
    ['Trip count', summary.tripCount],
    ['Gross fares (USD)', csvMoney(summary.grossFareCents)],
    ['Refunds (USD)', csvMoney(summary.refundCents)],
    ['Platform fees 20% (USD)', csvMoney(summary.platformFeeCents)],
    ['Net fares after platform fee (USD)', csvMoney(summary.netFareCents)],
    ['Tips (USD)', tipsCell],
    ['Wait fees (USD)', waitCell],
    ['Driver net (USD)', csvMoney(summary.driverNetCents)],
    [],
    ['Completed at', 'Rider first name', 'Area', 'Gross fare (USD)', 'Platform fee (USD)', 'Tips (USD)', 'Wait fee (USD)', 'Driver net (USD)'],
    ...(summary.trips || []).map((trip) => [
      trip.completedAt || '',
      trip.riderFirstName || '',
      trip.routeLabel || 'Trip completed',
      csvMoney(trip.fareCents),
      csvMoney(trip.platformFeeCents),
      trip.tipCents == null ? '' : csvMoney(trip.tipCents),
      trip.waitFeeCents == null ? '' : csvMoney(trip.waitFeeCents),
      csvMoney(trip.earnedCents),
    ]),
  ]
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
}

export function annualTaxCsvFilename(year) {
  return `clemson-rides-earnings-${year}.csv`
}

async function selectCompletedTrips(driverId) {
  const baseQuery = () => supabase
    .from('trips')
    .select(`${TRIP_BASE}, tip_cents`)
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1000)

  const first = await baseQuery()
  if (!first.error) return first
  if (!/tip_cents/i.test(first.error.message || '')) return first
  return supabase
    .from('trips')
    .select(TRIP_BASE)
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1000)
}

async function fetchPaymentExtras() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  try {
    const res = await fetch('/api/driver-earnings', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * RLS-safe earnings for the signed-in driver.
 * Returned trips are sanitized — no exact addresses or last names.
 */
export async function fetchDriverEarningsReport(driverId, { now = new Date(), timeZone = localTimeZone() } = {}) {
  if (!supabase || !driverId) {
    const summary = summarizeDriverEarnings([], { now, timeZone })
    return { trips: [], summary, paymentsLoaded: false }
  }

  const { data, error } = await selectCompletedTrips(driverId)
  if (error) throw new Error(error.message || 'Could not load earnings')
  const rows = data || []

  const riderIds = [...new Set(rows.map((row) => row.rider_id).filter(Boolean))]
  /** @type {Record<string, string>} */
  const firstNames = {}
  if (riderIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', riderIds)
    for (const profile of profiles || []) {
      firstNames[profile.id] = displayFirstName(profile.full_name)
    }
  }

  const extras = await fetchPaymentExtras()
  const paymentsByTrip = extras?.paymentsByTrip || {}
  const billsByTrip = extras?.billsByTrip || {}

  const trips = rows.map((row) => sanitizeCompletedTripForDriver(row, {
    riderName: firstNames[row.rider_id] || '',
    payments: paymentsByTrip[row.id] || [],
    bill: billsByTrip[row.id] || null,
  }))

  return {
    trips,
    summary: summarizeDriverEarnings(trips, { now, timeZone }),
    paymentsLoaded: Boolean(extras),
  }
}
