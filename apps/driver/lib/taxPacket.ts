import type { SupabaseClient } from '@supabase/supabase-js'
import { authedJson } from '../../../packages/rides-native/apiClient.js'
import { driverTripEarnings } from '../../../shared/driverTripEarnings.js'
import {
  FORM_1099_INFO_URL,
  MILEAGE_ESTIMATE_NOTE,
  STRIPE_1099_NOTE,
  STRIPE_CONNECT_1099_URL,
  STRIPE_TAX_REPORTING_URL,
  TAX_NOT_ADVICE,
  TAX_TIME_ZONE,
  buildYearEndPacket,
  taxYearOf,
} from '../../../shared/driverTaxMileage.js'
import { buildYearlyEarningsSummary, estimateDriverTaxes } from '../../../shared/yearlyEarnings.js'
import { driverNetCents, platformFeeCents } from '../../../shared/platformFee.js'
import { coarseAreaLabel } from '../../../src/lib/privacyDisplay.js'

const TRIP_RECORD_NOTE = 'These totals are from trip records on this account. Platform fees are the remainder after your recorded net. Tips are not in the platform fee. Cancel fees use the standard fee. Open this screen again when the tax summary service is available for payment adjustments and payout rows.'

const FULL_TRIP_COLUMNS = [
  'id',
  'driver_id',
  'status',
  'fare_cents',
  'tip_cents',
  'pickup_label',
  'dropoff_label',
  'pickup_lat',
  'pickup_lng',
  'dropoff_lat',
  'dropoff_lng',
  'completed_at',
  'accepted_at',
  'requested_at',
  'canceled_at',
  'wait_fee_cents',
  'cancel_fee_cents',
  'driver_wait_earnings_cents',
  'metadata',
].join(', ')

const SHORT_TRIP_COLUMNS = 'id, status, fare_cents, pickup_label, dropoff_label, completed_at, canceled_at, wait_fee_cents, cancel_fee_cents, driver_wait_earnings_cents, metadata'

const MISSING = /schema cache|does not exist|could not find the table|column/i

export type TaxSource = 'server' | 'trip-records'

export type MileageTripLine = {
  id: string
  status: string
  completedAt: string | null
  pickupLabel: string
  dropoffLabel: string
  onTripMiles: number | null
  onTripSource: string
  enrouteMiles: number | null
  enrouteSource: string
  deductibleMiles: number
  rateCentsPerMile: number | null
  estimatedDeductionCents: number | null
}

export type YearEndView = {
  year: number
  years: number[]
  timeZone: string
  grossEarningsCents: number
  tipsCents: number | null
  platformFeeCents: number
  driverNetCents: number
  earningsTripCount: number
  payoutsCents: number
  pendingPayoutCents: number
  onTripMiles: number
  enrouteMiles: number
  deductibleMiles: number
  enrouteUntrackedTrips: number
  estimatedDeductionCents: number | null
  estimate: true
  rateGap: boolean
  rateLabel: string
  disclaimer: string
  mileageEstimateNote: string
  stripe1099Note: string
  stripe1099Url: string
  form1099InfoUrl: string
  stripeTaxReportingUrl: string
  trips: MileageTripLine[]
  grossFareCents: number | null
  bonusPerkCents: number
  netPayoutCents: number
  months: YearMonthLine[]
  taxEstimate: TaxEstimate | null
  source: TaxSource
  sourceNote: string | null
}

export type YearMonthLine = {
  month: number
  label: string
  grossFareCents: number
  tipsCents: number
  platformFeeCents: number
  bonusPerkCents: number
  netCents: number
}

export type TaxEstimate = {
  taxableEarningsCents: number
  mileageDeductionCents: number | null
  selfEmploymentTaxCents: number
  quarterlySetAsideCents: number
  note: string
}

type TripRow = {
  id?: string
  driver_id?: string
  status?: string
  fare_cents?: number | null
  tip_cents?: number | null
  pickup_label?: string | null
  dropoff_label?: string | null
  pickup_lat?: number | null
  pickup_lng?: number | null
  dropoff_lat?: number | null
  dropoff_lng?: number | null
  completed_at?: string | null
  canceled_at?: string | null
  requested_at?: string | null
  wait_fee_cents?: number | null
  cancel_fee_cents?: number | null
  driver_wait_earnings_cents?: number | null
  metadata?: Record<string, unknown> | null
}

type QueryRows = { data: unknown[] | null; error: { message?: string } | null }

function asObjects(rows: unknown[]): object[] {
  return rows.filter((row): row is object => row != null && typeof row === 'object')
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function monthLine(row: unknown): YearMonthLine | null {
  if (!row || typeof row !== 'object') return null
  const month = row as Record<string, unknown>
  const index = finiteNumber(month.month)
  if (index < 1 || index > 12) return null
  return {
    month: index,
    label: String(month.label || ''),
    grossFareCents: finiteNumber(month.grossFareCents),
    tipsCents: finiteNumber(month.tipsCents),
    platformFeeCents: finiteNumber(month.platformFeeCents),
    bonusPerkCents: finiteNumber(month.bonusPerkCents),
    netCents: finiteNumber(month.netCents),
  }
}

function estimateLine(row: unknown, fallbackNet: number, fallbackDeduction: number | null): TaxEstimate {
  if (row && typeof row === 'object') {
    const estimate = row as Record<string, unknown>
    return {
      taxableEarningsCents: finiteNumber(estimate.taxableEarningsCents),
      mileageDeductionCents: estimate.mileageDeductionCents == null ? null : finiteNumber(estimate.mileageDeductionCents),
      selfEmploymentTaxCents: finiteNumber(estimate.selfEmploymentTaxCents),
      quarterlySetAsideCents: finiteNumber(estimate.quarterlySetAsideCents),
      note: String(estimate.note || ''),
    }
  }
  return estimateDriverTaxes({
    netEarningsCents: fallbackNet,
    mileageDeductionCents: fallbackDeduction,
  }) as TaxEstimate
}

function tripLine(row: unknown): MileageTripLine | null {
  if (!row || typeof row !== 'object') return null
  const trip = row as Record<string, unknown>
  const id = String(trip.id || '')
  if (!id) return null
  return {
    id,
    status: String(trip.status || ''),
    completedAt: typeof trip.completedAt === 'string' ? trip.completedAt : null,
    pickupLabel: String(trip.pickupLabel || 'Trip'),
    dropoffLabel: String(trip.dropoffLabel || 'Trip'),
    onTripMiles: nullableNumber(trip.onTripMiles),
    onTripSource: String(trip.onTripSource || 'unavailable'),
    enrouteMiles: nullableNumber(trip.enrouteMiles),
    enrouteSource: String(trip.enrouteSource || 'unavailable'),
    deductibleMiles: finiteNumber(trip.deductibleMiles),
    rateCentsPerMile: nullableNumber(trip.rateCentsPerMile),
    estimatedDeductionCents: trip.estimatedDeductionCents == null ? null : finiteNumber(trip.estimatedDeductionCents),
  }
}

export function viewFromServer(packet: Record<string, unknown>): YearEndView {
  const year = finiteNumber(packet.year)
  const listed = Array.isArray(packet.years)
    ? packet.years.map((item) => finiteNumber(item)).filter((item) => item >= 2000)
    : []
  const years = listed.length ? [...new Set(listed)].sort((a, b) => b - a) : [year]
  const trips = Array.isArray(packet.trips)
    ? packet.trips.flatMap((row) => {
      const line = tripLine(row)
      return line ? [line] : []
    })
    : []
  return {
    year,
    years,
    timeZone: typeof packet.timeZone === 'string' ? packet.timeZone : TAX_TIME_ZONE,
    grossEarningsCents: finiteNumber(packet.grossEarningsCents),
    tipsCents: packet.tipsCents == null ? null : finiteNumber(packet.tipsCents),
    platformFeeCents: finiteNumber(packet.platformFeeCents),
    driverNetCents: finiteNumber(packet.driverNetCents),
    earningsTripCount: finiteNumber(packet.earningsTripCount),
    payoutsCents: finiteNumber(packet.payoutsCents),
    pendingPayoutCents: finiteNumber(packet.pendingPayoutCents),
    onTripMiles: finiteNumber(packet.onTripMiles),
    enrouteMiles: finiteNumber(packet.enrouteMiles),
    deductibleMiles: finiteNumber(packet.deductibleMiles),
    enrouteUntrackedTrips: finiteNumber(packet.enrouteUntrackedTrips),
    estimatedDeductionCents: packet.estimatedDeductionCents == null ? null : finiteNumber(packet.estimatedDeductionCents),
    estimate: true,
    rateGap: Boolean(packet.rateGap),
    rateLabel: String(packet.rateLabel || ''),
    disclaimer: String(packet.disclaimer || TAX_NOT_ADVICE),
    mileageEstimateNote: String(packet.mileageEstimateNote || MILEAGE_ESTIMATE_NOTE),
    stripe1099Note: String(packet.stripe1099Note || STRIPE_1099_NOTE),
    stripe1099Url: String(packet.stripe1099Url || STRIPE_CONNECT_1099_URL),
    form1099InfoUrl: String(packet.form1099InfoUrl || FORM_1099_INFO_URL),
    stripeTaxReportingUrl: String(packet.stripeTaxReportingUrl || STRIPE_TAX_REPORTING_URL),
    trips,
    grossFareCents: packet.grossFareCents == null ? null : finiteNumber(packet.grossFareCents),
    bonusPerkCents: finiteNumber(packet.bonusPerkCents),
    netPayoutCents: packet.netPayoutCents == null ? finiteNumber(packet.payoutsCents) : finiteNumber(packet.netPayoutCents),
    months: Array.isArray(packet.months)
      ? packet.months.flatMap((row) => {
        const line = monthLine(row)
        return line ? [line] : []
      })
      : [],
    taxEstimate: estimateLine(
      packet.taxEstimate,
      finiteNumber(packet.driverNetCents),
      packet.estimatedDeductionCents == null ? null : finiteNumber(packet.estimatedDeductionCents),
    ),
    source: 'server',
    sourceNote: null,
  }
}

function whenOf(trip: TripRow): string | null {
  return trip.completed_at || trip.canceled_at || trip.requested_at || null
}

function knownTip(trip: TripRow): number | null {
  if (trip.tip_cents == null || String(trip.tip_cents) === '') return null
  const n = Number(trip.tip_cents)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
}

function payoutRecord(trip: TripRow): { trip_id: string; driver_id?: string; status?: string; amount_cents?: number } | null {
  const meta = trip.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const payout = meta.payout && typeof meta.payout === 'object' ? meta.payout as { status?: string; amountCents?: number; amount_cents?: number } : null
  if (!payout || !trip.id) return null
  return {
    trip_id: trip.id,
    driver_id: trip.driver_id,
    status: payout.status,
    amount_cents: payout.amountCents ?? payout.amount_cents,
  }
}

type SnapshotMoney = { gross: number; tip: number | null; fee: number; net: number }

function snapshotMoney(trip: TripRow): SnapshotMoney | null {
  const status = String(trip.status || '')
  const earnings = driverTripEarnings(trip)
  const cancel = Math.max(0, Math.round(Number(trip.cancel_fee_cents) || 0))
  const wait = Math.max(0, Math.round(Number(trip.wait_fee_cents) || 0))
  const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
  if (status === 'cancelled_wait') {
    const gross = wait + cancel
    const net = finiteNumber(earnings.netCents)
    return { gross, tip: 0, fee: Math.max(0, gross - net), net }
  }
  if (status === 'canceled') {
    if (cancel <= 0) return null
    return { gross: cancel, tip: 0, fee: platformFeeCents(cancel), net: driverNetCents(cancel) }
  }
  if (status !== 'completed') return null
  const tip = knownTip(trip)
  // Tips go 100% to the driver. They are never part of the platform fee.
  const waitFee = Math.max(0, wait - finiteNumber(earnings.waitCents))
  return {
    gross: fare + (tip || 0) + wait,
    tip,
    fee: finiteNumber(earnings.platformFeeCents) + waitFee,
    net: finiteNumber(earnings.netCents) + (tip || 0),
  }
}

function countsInYear(trip: TripRow): boolean {
  const status = String(trip.status || '')
  if (status === 'completed' || status === 'cancelled_wait') return true
  if (status === 'canceled') return Math.max(0, Math.round(Number(trip.cancel_fee_cents) || 0)) > 0 || Boolean(payoutRecord(trip))
  return false
}

export function yearsOnRecord(trips: TripRow[], now = new Date()): number[] {
  const years = new Set<number>()
  const current = taxYearOf(now.toISOString())
  if (current) years.add(current)
  for (const trip of trips) {
    const when = whenOf(trip)
    const year = when ? taxYearOf(when) : null
    if (year) years.add(year)
  }
  return [...years].sort((a, b) => b - a)
}

export function snapshotYearEnd({
  trips = [],
  logs = [],
  rates = null,
  year = null,
  now = new Date(),
  driverId = null,
}: {
  trips?: TripRow[]
  logs?: object[]
  rates?: object[] | null
  year?: number | null
  now?: Date
  driverId?: string | null
} = {}): YearEndView {
  const owned = (trips || []).filter((trip) => !driverId || !trip.driver_id || trip.driver_id === driverId)
  const years = yearsOnRecord(owned, now)
  const selected = year || years[0] || taxYearOf(now.toISOString()) || now.getFullYear()
  let gross = 0
  let fee = 0
  let net = 0
  let tips = 0
  let tipsKnown = false
  let count = 0
  const mileageTrips = []
  const payoutRows = []
  for (const trip of owned) {
    const when = whenOf(trip)
    if (taxYearOf(when) !== selected) continue
    if (!countsInYear(trip)) continue
    const money = snapshotMoney(trip)
    if (money) {
      gross += money.gross
      fee += money.fee
      net += money.net
      count += 1
      if (money.tip != null) {
        tipsKnown = true
        tips += money.tip
      }
    }
    const payout = payoutRecord(trip)
    if (payout) payoutRows.push(payout)
    mileageTrips.push({
      id: trip.id,
      status: trip.status,
      completedAt: when,
      pickupLabel: coarseAreaLabel(trip.pickup_label),
      dropoffLabel: coarseAreaLabel(trip.dropoff_label),
      metadata: trip.metadata,
      pickup_lat: trip.pickup_lat,
      pickup_lng: trip.pickup_lng,
      dropoff_lat: trip.dropoff_lat,
      dropoff_lng: trip.dropoff_lng,
    })
  }
  const packet = buildYearEndPacket({
    year: selected,
    trips: mileageTrips,
    logs,
    rates: rates && rates.length ? rates : undefined,
    payoutRows,
    grossEarningsCents: gross,
    tipsCents: tipsKnown ? tips : null,
    platformFeeCents: fee,
    driverNetCents: net,
    earningsTripCount: count,
  }) as Record<string, unknown>
  const yearly = buildYearlyEarningsSummary({
    year: selected,
    now,
    trips: owned,
    mileageDeductionCents: packet.estimatedDeductionCents == null ? null : finiteNumber(packet.estimatedDeductionCents),
    payoutsCents: finiteNumber(packet.payoutsCents),
  })
  const view = viewFromServer({
    ...packet,
    years,
    grossFareCents: yearly.grossFareCents,
    bonusPerkCents: yearly.bonusPerkCents,
    netPayoutCents: yearly.netPayoutCents,
    months: yearly.months,
    taxEstimate: yearly.taxEstimate,
  })
  return { ...view, source: 'trip-records', sourceNote: TRIP_RECORD_NOTE }
}

async function optionalRows(query: PromiseLike<QueryRows>): Promise<unknown[]> {
  const result = await query
  if (!result?.error) return result?.data || []
  if (MISSING.test(result.error.message || '')) return []
  throw new Error(result.error.message || 'Could not load tax records')
}

async function loadTrips(client: SupabaseClient, driverId: string): Promise<TripRow[]> {
  const first = await client
    .from('trips')
    .select(FULL_TRIP_COLUMNS)
    .eq('driver_id', driverId)
    .in('status', ['completed', 'canceled', 'cancelled_wait'])
    .order('completed_at', { ascending: false })
    .limit(1000)
  if (!first.error) return (first.data || []) as TripRow[]
  if (!MISSING.test(first.error.message || '')) throw new Error(first.error.message)
  const second = await client
    .from('trips')
    .select(SHORT_TRIP_COLUMNS)
    .eq('driver_id', driverId)
    .in('status', ['completed', 'canceled', 'cancelled_wait'])
    .order('completed_at', { ascending: false })
    .limit(1000)
  if (second.error) throw new Error(second.error.message)
  return (second.data || []) as TripRow[]
}

async function loadTripRecordYearEnd(client: SupabaseClient, driverId: string, year: number | null): Promise<YearEndView> {
  const [trips, logs, rates] = await Promise.all([
    loadTrips(client, driverId),
    optionalRows(client.from('driver_mileage_logs').select('trip_id, tax_year, on_trip_miles, on_trip_source, enroute_miles, enroute_source, deductible_miles, completed_at').eq('driver_id', driverId)),
    optionalRows(client.from('driver_mileage_rates').select('tax_year, starts_on, ends_on, cents_per_mile, label, source_note').order('starts_on', { ascending: true })),
  ])
  return snapshotYearEnd({ trips, logs: asObjects(logs), rates: asObjects(rates), year, driverId })
}

export async function loadYearEnd(client: SupabaseClient, driverId: string, year: number | null): Promise<YearEndView> {
  const path = year == null
    ? '/api/driver?action=tax-summary'
    : `/api/driver?action=tax-summary&year=${year}`
  try {
    const packet = await authedJson<Record<string, unknown>>(client, path)
    if (!packet || packet.year == null) throw new Error('Tax summary was incomplete')
    return viewFromServer(packet)
  } catch (serverError) {
    try {
      return await loadTripRecordYearEnd(client, driverId, year)
    } catch (localError) {
      const serverMessage = serverError instanceof Error ? serverError.message : 'Tax summary unavailable'
      const localMessage = localError instanceof Error ? localError.message : 'Trip records unavailable'
      throw new Error(`${serverMessage}. ${localMessage}`)
    }
  }
}
