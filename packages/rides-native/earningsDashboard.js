/**
 * View models for the driver earnings dashboard.
 * Streak cards match GET /api/driver?action=perks (streak bonuses).
 * Best hours and zones match GET /api/driver?action=forecast.
 * Payout timing follows the daily 12:00 UTC sweep.
 */
import { carpoolPayFromTrip, tripEarnedCents, tripPayoutCents } from './tripTags.js'
import { driverBoostShareCents, readBoostCents } from '../../shared/scheduledBoost.js'

export const PAYOUT_SWEEP_UTC_HOUR = 12
const ZONE = 'America/New_York'
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export function tipCents(payments) {
  return (payments || []).reduce((sum, payment) => {
    if (String(payment?.kind) !== 'tip') return sum
    const status = String(payment.status || 'succeeded')
    if (/fail|refund|cancel/i.test(status)) return sum
    return sum + Math.max(0, Math.round(Number(payment.amountCents ?? payment.amount_cents) || 0))
  }, 0)
}

function earnedStatus(status) {
  return status === 'completed' || status === 'cancelled_wait'
}

function rideWhen(trip) {
  return trip?.status === 'cancelled_wait' ? trip.canceled_at : trip.completed_at
}

export function tipsBreakdown(trips, paymentsByTrip) {
  const payments = paymentsByTrip || {}
  let tipTotal = 0
  let netCents = 0
  let completedRides = 0
  const rides = []
  for (const trip of trips || []) {
    if (trip?.status !== 'completed') continue
    completedRides += 1
    netCents += tripPayoutCents(trip)
    const cents = tipCents(payments[trip.id])
    if (cents <= 0) continue
    tipTotal += cents
    rides.push({
      tripId: trip.id,
      label: trip.dropoff_label || trip.pickup_label || 'Ride',
      tipCents: cents,
      at: trip.completed_at || null,
    })
  }
  rides.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  const tippedRides = rides.length
  const take = netCents + tipTotal
  return {
    tipCents: tipTotal,
    tippedRides,
    completedRides,
    averageTipCents: tippedRides ? Math.round(tipTotal / tippedRides) : 0,
    shareOfTake: take > 0 ? tipTotal / take : 0,
    rides,
  }
}

function streakCard(id, title, unit, view) {
  if (!view || view.enabled === false) return null
  const target = Math.max(1, Math.round(Number(view.target) || 1))
  const current = Math.max(0, Math.round(Number(view.current) || 0))
  const toNext = Math.max(0, Math.round(Number(view.toNext ?? (target - (current % target))) || 0))
  const progress = Number.isFinite(Number(view.progress))
    ? Math.max(0, Math.min(1, Number(view.progress)))
    : (current % target) / target
  return {
    id,
    title,
    unit,
    current,
    target,
    toNext,
    progress,
    bonusCents: Math.max(0, Math.round(Number(view.bonusCents) || 0)),
  }
}

export function bonusLabel(kind) {
  switch (kind) {
    case 'streak_trips':
      return 'Trip streak bonus'
    case 'streak_days':
      return 'Day streak bonus'
    case '':
      return 'Bonus'
    default:
      return String(kind || 'Bonus').replace(/_/g, ' ')
  }
}

export function streakBoard(perks) {
  if (!perks || typeof perks !== 'object') return { available: false, cards: [], bonuses: [] }
  const streaks = perks.streaks || {}
  const cards = [
    streakCard('trips', 'Trip streak', 'trips', streaks.trips),
    streakCard('days', 'Day streak', 'days', streaks.days),
  ].filter(Boolean)
  const bonuses = (Array.isArray(perks.bonuses) ? perks.bonuses : []).map((row) => ({
    kind: String(row?.kind || ''),
    label: bonusLabel(String(row?.kind || '')),
    amountCents: Math.max(0, Math.round(Number(row?.amountCents ?? row?.amount_cents) || 0)),
    status: String(row?.status || 'pending'),
    at: row?.at || null,
  }))
  return { available: true, cards, bonuses }
}

export function formatBestWindow(slot, timeZone = ZONE) {
  const start = new Date(slot?.startsAt)
  const end = new Date(slot?.endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  const startText = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric' }).format(start)
  const endText = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }).format(end)
  return `${startText}–${endText}`
}

export function forecastHighlights(forecast, limit = 3) {
  const empty = { available: false, lowData: false, disclaimer: '', eventsNote: null, hours: [], zones: [] }
  if (!forecast || !Array.isArray(forecast.top)) return empty
  const cap = Math.max(1, Math.round(Number(limit) || 3))
  const hours = forecast.top.slice(0, cap).map((slot) => ({
    zone: slot.zone,
    zoneLabel: slot.zoneLabel || slot.zone,
    window: formatBestWindow(slot),
    startsAt: slot.startsAt,
    expectedCentsPerHour: Math.max(0, Math.round(Number(slot.expectedCentsPerHour) || 0)),
    confidence: slot.confidence || 'low',
    reasons: Array.isArray(slot.reasons) ? slot.reasons.filter(Boolean) : [],
  }))
  const byZone = new Map()
  for (const slot of forecast.top) {
    const key = slot?.zone || slot?.zoneLabel
    if (!key) continue
    const cents = Math.max(0, Math.round(Number(slot.expectedCentsPerHour) || 0))
    const current = byZone.get(key)
    if (current && current.expectedCentsPerHour >= cents) continue
    byZone.set(key, {
      zone: slot.zone,
      zoneLabel: slot.zoneLabel || slot.zone,
      window: formatBestWindow(slot),
      expectedCentsPerHour: cents,
    })
  }
  const zones = [...byZone.values()].sort((a, b) => b.expectedCentsPerHour - a.expectedCentsPerHour || a.zoneLabel.localeCompare(b.zoneLabel))
  return {
    available: true,
    lowData: Boolean(forecast.lowData),
    disclaimer: String(forecast.disclaimer || ''),
    eventsNote: forecast.eventsNote || null,
    hours,
    zones: zones.slice(0, 4),
  }
}

/** Next 12:00 UTC at or after `notBeforeMs`. That is the daily payout sweep. */
export function nextDailyPayoutAt(notBeforeMs) {
  const at = Number(notBeforeMs)
  if (!Number.isFinite(at)) return null
  const day = new Date(at)
  let candidate = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), PAYOUT_SWEEP_UTC_HOUR, 0, 0, 0)
  if (candidate < at) candidate += DAY_MS
  return candidate
}

function payoutRecord(trip) {
  const meta = trip?.metadata
  if (!meta || typeof meta !== 'object') return null
  const payout = meta.payout
  if (!payout || typeof payout !== 'object') return null
  return payout
}

function historyFromTrips(trips) {
  const rows = []
  for (const trip of trips || []) {
    const payout = payoutRecord(trip)
    if (!payout) continue
    if (payout.status !== 'paid' && payout.status !== 'failed') continue
    rows.push({
      id: `trip:${trip.id}`,
      label: trip.dropoff_label || trip.pickup_label || 'Trip',
      amountCents: Math.max(0, Math.round(Number(payout.amountCents) || tripPayoutCents(trip) || 0)),
      status: payout.status,
      at: payout.paidAt || rideWhen(trip) || null,
      lastError: payout.lastError || null,
      kind: 'trip',
    })
  }
  return rows
}

function historyFromBonuses(bonuses) {
  return (bonuses || [])
    .filter((row) => row.status === 'paid' || row.status === 'failed')
    .map((row) => ({
      id: `bonus:${row.kind}:${row.at || row.amountCents}`,
      label: row.label,
      amountCents: row.amountCents,
      status: row.status,
      at: row.at,
      lastError: null,
      kind: 'bonus',
    }))
}

export function payoutTimeline({ trips, payouts, bonuses, now = Date.now() } = {}) {
  const pending = Array.isArray(payouts?.pending) ? payouts.pending : []
  const pendingCents = Math.max(0, Math.round(Number(payouts?.pendingCents) || pending.reduce((sum, row) => sum + (Number(row?.amountCents) || 0), 0)))
  const waitingBonuses = (bonuses || []).filter((row) => row.status === 'pending' || row.status === 'failed')
  const bonusWaitingCents = waitingBonuses.reduce((sum, row) => sum + row.amountCents, 0)
  const waitingCents = pendingCents + bonusWaitingCents
  let etaAt = null
  if (waitingCents > 0) {
    let gate = now
    const retries = pending
      .map((row) => (row?.nextRetryAt ? Date.parse(row.nextRetryAt) : now))
      .filter((at) => Number.isFinite(at))
    const dueNow = retries.some((at) => at <= now) || retries.length === 0
    if (!dueNow) gate = Math.min(...retries)
    etaAt = nextDailyPayoutAt(Math.max(now, gate))
  }
  const history = [...historyFromTrips(trips), ...historyFromBonuses(bonuses)]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return {
    pendingCents,
    paidCents: Math.max(0, Math.round(Number(payouts?.paidCents) || 0)),
    waitingCents,
    etaAt,
    history,
  }
}

export function formatPayoutEta(etaAt, timeZone = ZONE) {
  if (etaAt == null) return ''
  const when = new Date(etaAt)
  if (Number.isNaN(when.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(when)
}

export function rideDetails(trips, paymentsByTrip) {
  const payments = paymentsByTrip || {}
  const rows = []
  for (const trip of trips || []) {
    if (!earnedStatus(trip?.status)) continue
    const pay = trip.status === 'cancelled_wait' ? null : carpoolPayFromTrip(trip)
    const payout = payoutRecord(trip)
    rows.push({
      id: trip.id,
      status: trip.status,
      at: rideWhen(trip) || null,
      pickup: trip.pickup_label || 'Pickup',
      dropoff: trip.dropoff_label || 'Dropoff',
      netCents: tripEarnedCents(trip),
      payoutCents: tripPayoutCents(trip),
      tipCents: trip.status === 'completed' ? tipCents(payments[trip.id]) : 0,
      boostCents: trip.status === 'completed' ? driverBoostShareCents(readBoostCents(trip)) : 0,
      carpoolBonusCents: pay?.showBonus ? pay.bonusCents : 0,
      payoutStatus: payout?.status || null,
    })
  }
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return rows
}
