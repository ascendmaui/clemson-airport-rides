/**
 * Calendar-year earnings for the driver tax packet.
 * Tips are 100% the driver's and are not part of the platform fee.
 * Mileage deduction and the rate bands come from the year-end packet.
 */
import { driverTripEarnings } from './driverTripEarnings.js'
import { platformFeeCents } from './platformFee.js'
import { TAX_TIME_ZONE, taxYearOf } from './driverTaxMileage.js'

export const TAX_ESTIMATE_NOTE = 'Estimate only. Self-employment tax here is 15.3% of 92.35% of net earnings after the mileage deduction. It is not a filed return and it is not tax advice.'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function cents(value) {
  return Math.max(0, Math.round(Number(value) || 0))
}

function zonedParts(iso, timeZone) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const bag = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  const year = Number(bag.year)
  const month = Number(bag.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
  return { year, month }
}

function whenOf(trip) {
  return trip?.completedAt || trip?.completed_at || trip?.canceledAt || trip?.canceled_at || trip?.requested_at || null
}

function isSanitized(trip) {
  return trip != null && (
    Object.prototype.hasOwnProperty.call(trip, 'fareCents')
    || Object.prototype.hasOwnProperty.call(trip, 'earnedCents')
  )
}

function sanitizedMoney(trip) {
  const status = String(trip.status || 'completed')
  if (status !== 'completed' && status !== 'cancelled_wait' && status !== 'canceled') return null
  const fare = cents(trip.fareCents)
  const tipKnown = trip.tipCents != null || cents(trip.prepaidTipCents) > 0
  const tips = (trip.tipCents == null ? 0 : cents(trip.tipCents)) + cents(trip.prepaidTipCents)
  const fee = cents(trip.platformFeeCents)
  const bonus = cents(trip.boostCents) + cents(trip.backupBonusCents)
  if (status === 'canceled' && fare <= 0 && tips <= 0 && fee <= 0) return null
  return {
    grossFareCents: fare,
    tipsCents: tips,
    tipsKnown: tipKnown,
    platformFeeCents: fee,
    bonusPerkCents: bonus,
  }
}

function rawMoney(trip) {
  const status = String(trip?.status || '')
  const earnings = driverTripEarnings(trip)
  const cancel = cents(trip?.cancel_fee_cents)
  if (status === 'canceled' && cancel <= 0 && earnings.netCents <= 0) return null
  if (status !== 'completed' && status !== 'cancelled_wait' && status !== 'canceled') return null
  const wait = cents(trip?.wait_fee_cents)
  let grossFare = 0
  let fee = 0
  let tips = 0
  let bonus = 0
  if (status === 'completed') {
    grossFare = cents(trip?.fare_cents)
    fee = earnings.platformFeeCents + Math.max(0, wait - earnings.waitCents)
    tips = (trip?.tip_cents == null ? 0 : cents(trip.tip_cents)) + earnings.prepaidTipCents
    bonus = earnings.boostCents + earnings.backupBonusCents + earnings.tigerHeatBonusCents
  } else if (status === 'cancelled_wait') {
    const gross = wait + cancel
    fee = Math.max(0, gross - earnings.netCents)
    grossFare = 0
  } else {
    grossFare = cancel
    fee = platformFeeCents(cancel)
  }
  return {
    grossFareCents: grossFare,
    tipsCents: tips,
    tipsKnown: status !== 'completed' || trip?.tip_cents != null || earnings.prepaidTipCents > 0,
    platformFeeCents: fee,
    bonusPerkCents: bonus,
  }
}

function tripMoney(trip) {
  if (isSanitized(trip)) return sanitizedMoney(trip)
  return rawMoney(trip)
}

export function estimateDriverTaxes({ netEarningsCents = 0, mileageDeductionCents = null } = {}) {
  const known = mileageDeductionCents != null && Number.isFinite(Number(mileageDeductionCents))
  const deduction = known ? cents(mileageDeductionCents) : 0
  const net = cents(netEarningsCents)
  const taxableEarningsCents = Math.max(0, net - deduction)
  const seBase = Math.round((taxableEarningsCents * 9235) / 10000)
  const selfEmploymentTaxCents = Math.round((seBase * 153) / 1000)
  return {
    taxableEarningsCents,
    mileageDeductionCents: known ? deduction : null,
    selfEmploymentTaxCents,
    quarterlySetAsideCents: Math.round(selfEmploymentTaxCents / 4),
    note: TAX_ESTIMATE_NOTE,
  }
}

function emptyMonth(month) {
  return {
    month,
    label: MONTHS[month - 1],
    grossFareCents: 0,
    tipsCents: 0,
    platformFeeCents: 0,
    bonusPerkCents: 0,
    netCents: 0,
  }
}

/**
 * @param {object} input
 * @param {number} input.year
 * @param {string} [input.timeZone]
 * @param {Date} [input.now]
 * @param {object[]} [input.trips]
 * @param {object[]} [input.bonuses] ledger rows: amount_cents, created_at, status
 * @param {number|null} [input.mileageDeductionCents]
 * @param {number} [input.payoutsCents]
 */
export function buildYearlyEarningsSummary({
  year,
  timeZone = TAX_TIME_ZONE,
  now = new Date(),
  trips = [],
  bonuses = [],
  mileageDeductionCents = null,
  payoutsCents = 0,
} = {}) {
  const y = Number(year)
  const today = zonedParts(now.toISOString(), timeZone)
  const throughMonth = today && today.year === y ? today.month : 12
  const months = []
  for (let month = 1; month <= throughMonth; month += 1) months.push(emptyMonth(month))

  let grossFareCents = 0
  let tipsCents = 0
  let tipsKnown = false
  let platformFeeCentsTotal = 0
  let bonusPerkCents = 0

  for (const trip of trips || []) {
    const when = whenOf(trip)
    const parts = when ? zonedParts(when, timeZone) : null
    if (!parts || parts.year !== y || parts.month > throughMonth) continue
    const money = tripMoney(trip)
    if (!money) continue
    const bucket = months[parts.month - 1]
    bucket.grossFareCents += money.grossFareCents
    bucket.tipsCents += money.tipsCents
    bucket.platformFeeCents += money.platformFeeCents
    bucket.bonusPerkCents += money.bonusPerkCents
    bucket.netCents += money.grossFareCents - money.platformFeeCents + money.tipsCents + money.bonusPerkCents
    grossFareCents += money.grossFareCents
    tipsCents += money.tipsCents
    if (money.tipsKnown) tipsKnown = true
    platformFeeCentsTotal += money.platformFeeCents
    bonusPerkCents += money.bonusPerkCents
  }

  for (const row of bonuses || []) {
    const status = String(row?.status || 'pending')
    if (status === 'void' || status === 'failed') continue
    const when = row.paid_at || row.paidAt || row.created_at || row.createdAt
    const parts = when ? zonedParts(when, timeZone) : null
    if (!parts || parts.year !== y || parts.month > throughMonth) continue
    const amount = cents(row.amount_cents ?? row.amountCents)
    if (!amount) continue
    const bucket = months[parts.month - 1]
    bucket.bonusPerkCents += amount
    bucket.netCents += amount
    bonusPerkCents += amount
  }

  const netEarningsCents = grossFareCents - platformFeeCentsTotal + tipsCents + bonusPerkCents
  return {
    year: y,
    throughMonth,
    grossFareCents,
    tipsCents: tipsKnown ? tipsCents : null,
    platformFeeCents: platformFeeCentsTotal,
    bonusPerkCents,
    netEarningsCents,
    netPayoutCents: cents(payoutsCents),
    months,
    taxEstimate: estimateDriverTaxes({
      netEarningsCents,
      mileageDeductionCents,
    }),
  }
}
