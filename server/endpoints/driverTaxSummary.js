/**
 * GET /api/driver?action=tax-summary&year=2026
 * Year-end earnings and mileage for the signed-in driver.
 * Mileage is tracked from trip distance and, when it was captured, the drive
 * to pickup. The IRS rate is config. The result is an estimate, not tax advice.
 * 1099 forms stay on Stripe; the payload only links to them.
 */
import { admin, cors, json, userFromAuth } from '../friendRideLib.js'
import {
  buildAnnualTaxSummary,
  sanitizeCompletedTripForDriver,
  taxYears,
  zonedParts,
} from '../../src/lib/driverEarnings.js'
import { coarseAreaLabel } from '../../src/lib/privacyDisplay.js'
import {
  buildYearEndPacket,
  TAX_TIME_ZONE,
} from '../../shared/driverTaxMileage.js'

const TRIP_COLUMNS = [
  'id',
  'rider_id',
  'driver_id',
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
  'canceled_at',
  'wait_fee_cents',
  'cancel_fee_cents',
  'driver_wait_earnings_cents',
  'tip_cents',
  'boost_cents',
  'metadata',
].join(', ')

function missingTable(error) {
  return /schema cache|does not exist|could not find the table|column/i.test(error?.message || '')
}

export function yearFromRequest(req) {
  const rawUrl = String(req?.url || '')
  const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const fromQuery = req?.query?.year
  const raw = fromQuery == null || fromQuery === '' ? params.get('year') : String(Array.isArray(fromQuery) ? fromQuery[0] : fromQuery)
  if (raw == null || raw === '') return null
  const year = Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return Number.NaN
  return year
}

async function optionalRows(query) {
  const result = await query
  if (!result?.error) return result?.data || []
  if (missingTable(result.error)) return []
  throw new Error(result.error.message)
}

export async function loadTaxInputs(sb, driverId) {
  const tripsRes = await sb
    .from('trips')
    .select(TRIP_COLUMNS)
    .eq('driver_id', driverId)
    .in('status', ['completed', 'canceled', 'cancelled_wait'])
    .order('completed_at', { ascending: false })
    .limit(1000)
  if (tripsRes.error) throw new Error(tripsRes.error.message || 'Could not load trips')
  const trips = tripsRes.data || []
  const ids = trips.map((trip) => trip.id).filter(Boolean)
  const [payments, bills, logs, rates, payouts] = await Promise.all([
    ids.length
      ? optionalRows(sb.from('payments').select('trip_id, kind, amount_cents, status, metadata').in('trip_id', ids))
      : [],
    ids.length
      ? optionalRows(sb.from('ride_bills').select('trip_id, base_cents, distance_cents, time_cents, surge_cents, distance_m, duration_s').in('trip_id', ids))
      : [],
    optionalRows(sb.from('driver_mileage_logs').select('trip_id, tax_year, on_trip_miles, on_trip_source, enroute_miles, enroute_source, deductible_miles, completed_at').eq('driver_id', driverId)),
    optionalRows(sb.from('driver_mileage_rates').select('tax_year, starts_on, ends_on, cents_per_mile, label, source_note')),
    optionalRows(sb.from('driver_payouts').select('trip_id, driver_id, amount_cents, status').eq('driver_id', driverId)),
  ])
  return { trips, payments, bills, logs, rates, payouts }
}

function groupByTrip(rows, pick) {
  const grouped = {}
  for (const row of rows || []) {
    if (!row?.trip_id) continue
    const list = grouped[row.trip_id] || []
    list.push(pick(row))
    grouped[row.trip_id] = list
  }
  return grouped
}

export function packetFromInputs({
  trips = [],
  payments = [],
  bills = [],
  logs = [],
  rates = null,
  payouts = [],
  year = null,
  timeZone = TAX_TIME_ZONE,
  now = new Date(),
} = {}) {
  const paymentsByTrip = groupByTrip(payments, (row) => ({
    kind: row.kind,
    amountCents: Number(row.amount_cents) || 0,
    status: row.status,
    waitFeeBilledCents: Math.max(0, Number(row.metadata?.wait_fee_billed_cents) || 0),
  }))
  const billsByTrip = {}
  for (const row of bills || []) {
    if (!row?.trip_id) continue
    const cur = billsByTrip[row.trip_id] || { distanceM: null, durationS: null, baseCents: 0, distanceCents: 0, timeCents: 0, surgeCents: 0 }
    cur.baseCents += Number(row.base_cents) || 0
    cur.distanceCents += Number(row.distance_cents) || 0
    cur.timeCents += Number(row.time_cents) || 0
    cur.surgeCents += Number(row.surge_cents) || 0
    if (!cur.distanceM && row.distance_m) cur.distanceM = Number(row.distance_m)
    if (!cur.durationS && row.duration_s) cur.durationS = Number(row.duration_s)
    billsByTrip[row.trip_id] = cur
  }

  const sanitized = []
  const mileageTrips = []
  const driverId = (trips || []).find((row) => row?.driver_id)?.driver_id || null
  for (const row of trips || []) {
    if (driverId && row?.driver_id && row.driver_id !== driverId) continue
    const bill = billsByTrip[row.id] || null
    const safe = sanitizeCompletedTripForDriver(row, { payments: paymentsByTrip[row.id] || [], bill })
    if (row.status === 'canceled' && !(safe.cancelFeeCents > 0)) continue
    sanitized.push(safe)
    mileageTrips.push({
      id: row.id,
      status: row.status,
      completedAt: safe.completedAt,
      pickupLabel: coarseAreaLabel(row.pickup_label),
      dropoffLabel: coarseAreaLabel(row.dropoff_label),
      metadata: row.metadata,
      pickup_lat: row.pickup_lat,
      pickup_lng: row.pickup_lng,
      dropoff_lat: row.dropoff_lat,
      dropoff_lng: row.dropoff_lng,
      bill,
    })
  }

  const years = taxYears(sanitized, now, timeZone)
  const selected = year || years[0] || zonedParts(now, timeZone).year
  const tax = buildAnnualTaxSummary(sanitized, { year: selected, timeZone })
  const packet = buildYearEndPacket({
    year: selected,
    timeZone,
    trips: mileageTrips,
    logs,
    rates: rates && rates.length ? rates : undefined,
    payoutRows: (payouts || []).filter((row) => !driverId || !row.driver_id || row.driver_id === driverId),
    grossEarningsCents: tax.grossCents,
    tipsCents: tax.tipsCents,
    platformFeeCents: tax.platformFeeCents,
    driverNetCents: tax.driverNetCents,
    earningsTripCount: tax.tripCount,
  })
  return {
    ...packet,
    years,
    trips: packet.trips.map((trip) => ({
      id: trip.id,
      status: trip.status,
      completedAt: trip.completedAt,
      pickupLabel: trip.pickupLabel,
      dropoffLabel: trip.dropoffLabel,
      onTripMiles: trip.onTripMiles,
      onTripSource: trip.onTripSource,
      enrouteMiles: trip.enrouteMiles,
      enrouteSource: trip.enrouteSource,
      deductibleMiles: trip.deductibleMiles,
      rateCentsPerMile: trip.rateCentsPerMile,
      estimatedDeductionCents: trip.estimatedDeductionCents,
    })),
  }
}

async function rememberMileage(sb, driverId, packet) {
  const rows = (packet.trips || []).filter((trip) => trip.id).map((trip) => ({
    driver_id: driverId,
    trip_id: trip.id,
    tax_year: packet.year,
    completed_at: trip.completedAt,
    on_trip_miles: trip.onTripMiles,
    on_trip_source: trip.onTripSource,
    enroute_miles: trip.enrouteMiles,
    enroute_source: trip.enrouteSource,
    deductible_miles: trip.deductibleMiles,
    pickup_label: trip.pickupLabel,
    dropoff_label: trip.dropoffLabel,
    updated_at: new Date().toISOString(),
  }))
  if (!rows.length || typeof sb?.from !== 'function') return
  const saved = await sb.from('driver_mileage_logs').upsert(rows, { onConflict: 'driver_id,trip_id' })
  if (saved?.error && !missingTable(saved.error)) return
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  }
  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 401, { error: 'Sign in required' })
  }
  const requested = yearFromRequest(req)
  if (Number.isNaN(requested)) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 400, { error: 'Year must be a four-digit year' })
  }
  try {
    const inputs = deps.loadTaxInputs ? await deps.loadTaxInputs(sb, user.id) : await loadTaxInputs(sb, user.id)
    const packet = packetFromInputs({
      ...inputs,
      year: requested,
      timeZone: TAX_TIME_ZONE,
      now: deps.now || new Date(),
    })
    if (!deps.skipWrite) await rememberMileage(sb, user.id, packet)
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, packet)
  } catch (err) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 500, { error: err?.message || 'Could not build tax summary' })
  }
}
